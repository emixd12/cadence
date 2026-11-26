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
| Tickets 383–386: alongside follow-ups after the audit (D37) | 383 web part complete in the draft PR (migration `20261126230000`, push approved); 386 complete in source on `feat/alongside-386`; 383 Mac part, 384 and 385 open | 383 Mac: SQLite and sync planner must accept a guess dismissal while Completion places is off, before the flag is on for an account with a linked Mac. 385: the card needs a `coach_tips.link_target` constraint change and the owner's review | TICKETS, Tickets 383–386; DECISIONS, 2026-11-25 (D37) |
| Tickets 375–382: MCP Apps, the "Cadence day" view (D36) | Scoped November 25, 2026; plan audited; none started; 382 (later views) `deferred` | 375 (spike) first; then 376 and 377 in parallel; 379 (consent 500) any time; production flag, listings and public copy wait for the marketing site overhaul (Ticket 246) | TICKETS, Tickets 375–382; `docs/plans/2026-11-25-mcp-apps-expansion.md`; DECISIONS, 2026-11-25 (D36) |
| Tickets 367–374: Periods, and day notes and Periods in the Daily Brief (D35) | Planned November 25, 2026; plan reviewed; none started | 367 and 368 first; 374 (Mac) needs Ticket 363 on `main` and a Mac release | TICKETS, Tickets 367–374; `docs/plans/2026-11-25-periods.md`; DECISIONS, 2026-11-25 (D35) |
| Ticket 366: tracked time decides a Behavior's length from 3 tracked completions (D34) | Implemented in source November 25, 2026; all checks pass; not yet looked at in a browser | Check a Behavior with 3 tracked completions on production web after merge; installed Mac check with the next Mac release; advisor wording that compares tracked and intended time needs its own ticket | TICKETS, Ticket 366; DECISIONS, 2026-11-25 (D34) |
| Tickets 356–365: alongside Behaviors and the guessed Where (D33) | 356–364 complete, flag off. On `main`: 356–361 and 364; hosted migrations `20261125140000`–`20261125190000` pushed. In a draft PR: 362, 363, the 360/361 follow-ups and the audit fixes, with migrations `20261126200000`, `20261126210000` and `20261126220000` (hosted push approved by the owner November 25, D37). Web behind `CADENCE_ALONGSIDE`, Mac behind `VITE_CADENCE_ALONGSIDE` | Push the three migrations, merge the draft PR, run Ticket 365 acceptance. `CADENCE_ALONGSIDE` must not go on in Production until a contract-10 Mac build is released: a contract-9 Mac's export fails once a history event names `alongside`. The owner decides the Production flag and the Mac release | TICKETS, Tickets 356–365; DECISIONS, 2026-11-25 (D33, D37) |
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
| MCP acceptance tooling, Tickets 247–258 | Complete except conditional Ticket 253 (on hold); TICKETS reconciled November 11, 2026 | Consent Allow or Deny before hydration returns 500 (product finding, not fixed; Ticket 379) | STATUS, "Automated MCP client acceptance: Tickets 247–258 — October 31, 2026"; TICKETS, Ticket 253 |
| Connector Tickets 236, 240–242 (Hevy, iCloud, Outlook) | Hevy, Outlook (personal account) and iCloud (owner's Apple Account) passed on production web and installed Mac 0.1.10 (November 11–12); cross-tenant Outlook checks skipped by owner decision | Not verified on production: an iCloud event on Timeline (no events in the selected calendars), the Outlook `cadence://` completion, sign-out and account-switch cache cleanup, Hevy key entry on the Mac. Owner revokes the "Cadence QA" app-specific password when testing ends. 241 step 7 copy is live and awaits the owner's review | TICKETS, Tickets 236, 240, 241, 242; STATUS, "iCloud production acceptance — November 12, 2026" |
| Tickets 243–244: travel backlog | Filed October 22; backlog | None scheduled | TICKETS, Tickets 243–244 |
| Daily Brief release acceptance (grouped): Tickets 147, 148, 155, 161, 168, 169, 172, 173, 174, 182, 183, 185 | In progress or implemented in source; reconciled October 27: still open | Ticket 174 carries hosted, deployed-web and installed-desktop gates; 182–183 owner-run live checks; 185 awaits owner product decisions | TICKETS, Ticket 174 and each listed ticket |
| Google Calendar Timeline (grouped): Tickets 133–137, 141, 150 | In progress; reconciled October 27: still open | Post-approval web and native consent smoke checks; 137 provider-failure, Workspace and installed fixture cases; 150 live custom-name check | TICKETS, Tickets 137, 141, 150 |
| Earlier travel tickets (grouped): 160, 162–164, 166, 167, 170, 171 | Implemented in source or discovery complete | Release gates sit in Tickets 165 and 174; owner re-acceptance for 166–167 | TICKETS, each listed ticket |
| Desktop release follow-ups (grouped): Tickets 142, 143 | Complete in source; web deployed September 18 | Installed-native release acceptance | TICKETS, Tickets 142–143 |
| Operations (grouped): Tickets 091, 104, 105, 128 | 091 and 105 in progress; 104 and 128 blocked; reconciled October 27 | 104: operator diagnostics or an authorized route test; 105: verify deployed browser-push delivery after the reviewed web-push 4.0.0 upgrade; 128: a revised candidate needs a new measured gate | TICKETS, Tickets 091, 104, 105, 128 |

## Recent entries

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
## Ticket 385 complete in code: an advice card for the alongside question — November 26, 2026

Branch `feat/alongside-385`. Closes the advisor-tip gap Ticket 360 recorded: `setup_gaps`'s
`alongside_unanswered` now has a card, awaiting the owner's review.

- **Card:** `do-it-during-something-else` in `packages/core/src/data/advice-library.json`
  (library version `2026-11-25.1`), resting on Milkman, Minson and Volpp (2014), kind
  `randomized_trial`, strength limited. Behavior-scoped rule on `alongside_unanswered`
  (coach-signals version 4, so only with `CADENCE_ALONGSIDE` on). Ships as `draft` with no
  `reviewer` or `reviewed_at`: the matcher and the tip run skip it, and no tip shows.
- **Link:** new tip link target `alongside` opens the Behavior form at "Can be done
  alongside other things" (`?edit=<id>&field=alongside`); an account-wide tip picks the
  first Behavior whose question is open.
- **Migration:** `20261126240000_alongside_tip_link_target.sql` replaces the
  `coach_tips.link_target` check to allow `alongside`. Not applied locally; not additive,
  so the hosted push needs the owner's yes. It must be on the database before the card is
  activated. Smoke: `tests/sql/alongside-tip-link-target-smoke.sql` (not run).
- **To activate:** push the migration, then set the card's `status` to `active` and fill
  `reviewer` and `reviewed_at` (owner only).

Platform impact: web implemented; desktop not applicable (tips come from the hosted server;
the Mac opens the same shared form field); marketing not applicable; future mobile inherits
the resolvers. Messaging impact: P-103.
## Ticket 384 complete in source: calendar event places — November 26, 2026

- **Rule:** with `CADENCE_ALONGSIDE` on, each busy calendar event that reaches the free-slot
  rule carries Home, a saved place's key or nothing (unknown), from its location text by
  `travelPlaceKey` (`calendarEventPlace`, `planningPlaceCatalog` in `alongside.resolver.ts`).
  An alongside item is refused during an event at another known place; the Timeline cue
  shows again for those overlaps only. Calendar events stay out of pairing hosts.
- **Paths:** Daily Brief lines (Google MCP read, in-memory location sidecar), its answers
  (`readServerBriefCalendarBusy`, Google MCP), Chat (all sources), the web Timeline's "Move
  for today" and the web and Mac overlap cues (on the device, from the view's
  `planningPlaces` keys). Outlook and iCloud stay unknown on the Daily Brief paths: those reads
  ask for no location. Map: `docs/DATETIME_STRATEGY.md`, "Coarse event places".
- **Privacy:** no storage, logging, model input or MCP result carries the label, the keys or
  a location (`tests/calendar-event-place.boundary.test.ts`). Flag off: no new read, and
  request bodies and outputs are unchanged. No migration, no provider call, no new
  dependency. Not run in a browser or on an installed Mac.

Platform impact: web implemented; desktop overlap cue through the shared Timeline and
`local-timeline.service.ts` (the Mac offers no "Move for today" and its brief uses the hosted
routes); marketing not applicable; future mobile inherits the resolvers. Messaging impact: P-103.
## Ticket 383 Mac complete: guessed Where dismissals sync while Completion places is off — November 26, 2026

Branch `feat/alongside-383mac`, on the alongside branch with Ticket 383's web part.

- **Hazard confirmed by test:** before this change the shared planner deleted a hosted guess
  dismissal stored while labels were off (an ordinary sync planned a hosted delete), and the
  schema-29 SQLite trigger refused it (a first-link replacement would fail).
- **Mac:** SQLite schema 30 (`0030_guess_dismissal_without_labels.sql`) admits `home`,
  `anywhere` and `add_place` dismissals while labels are off. A linked Mac shows the hosted
  guessed Where and dismisses the shown guess with Completion places off; local mode has none.
- **Sync:** account sync contract 11. `retainPlaceLabelInvariants` keeps a guess dismissal
  while labels are off; turning labels off still deletes every dismissal. Hosted migration
  `20261126250000_account_sync_where_guess_dismissals.sql` (not applied or pushed) hides such
  rows from contracts 8 to 10 (Cadence for Mac 0.1.14 to 0.1.17), keeps them out of those
  contracts' apply results, and lets their own dismissal replace a hidden one. It inserts one
  registry row and changes the projection and apply functions for older contracts: it needs
  the owner's yes, and must reach the database no later than `20261126230000`. Minimum writer
  contract stays 8.
- **Verification:** resolver, native, store-contract and SQL fixtures
  (`tests/sql/ticket-383-mac-guess-dismissal-sync-smoke.sql`) against a scratch database
  with every migration, and the full check list in AGENTS.md. The web fixture
  `tests/sql/ticket-383-where-guess-dismissal-smoke.sql` expected a check violation where
  the trigger raises first; fixed.

Platform impact: web unchanged; desktop implemented (installed check in Ticket 365); marketing
not applicable; future mobile inherits the planner. Messaging impact: P-103.
## Ticket 386 complete in source: the estimate hash leaves Where out — November 25, 2026

- **Hash:** `behaviorEstimateInputHash` hashes the title, description and the recipe
  markers only (`v: 2`). Setting, changing or clearing Where keeps the cached length and
  alongside guess and makes no model call. A title or description change still asks again.
- **Where guess:** `cacheBehaviorEstimates` now stores the model's Where guess also when
  the person set Where. `currentEstimate` skips it while Where is set; clearing Where reads
  it again with no call. The request bytes are unchanged, flag on or off.
- **One-time cost:** every stored hash changes once, so each Behavior is asked again one
  time: one request per brief for up to 40 Behaviors with the flag off, at most two with it
  on (`docs/COSTS.md`). No compatibility path for old hashes (D37). No migration.

Platform impact: web implemented; desktop not applicable (estimates are hosted); marketing
not applicable; future mobile inherits the server rules. Messaging impact: none.

## Ticket 383 web complete: the guessed Where without Completion places — November 26, 2026

- **Web:** with `CADENCE_ALONGSIDE` on, the Behavior form and record show the guessed Where
  line whether or not Completion places is on. With labels off, markers, I'm here, prompts
  and counts stay hidden. Rule: `resolvePlaceLabelState`, `shownWhereGuessKey` and
  `whereSuggestionDismissible` in `place-label.resolver.ts`. The guesses read takes no label
  or position. Flag off: same reads, writes and DOM as before.
- **Dismissal while off:** only the guess the line shows. Migration
  `20261126230000_where_guess_dismissal_without_labels.sql` replaces
  `cadence_private.require_place_labels_enabled()` so a dismissal row with `home`, `anywhere`
  or `add_place` is admitted while labels are off. Not applied or pushed. Fixture:
  `tests/sql/ticket-383-where-guess-dismissal-smoke.sql`.
- **Retention:** Turn off still deletes every dismissal, as the Settings confirmation says.
- **Mac deferred:** the Mac keeps the guessed line behind Completion places. Its SQLite
  triggers (migration 0020) refuse a dismissal while labels are off, and the shared sync
  planner drops dismissals while labels are off. A linked Mac would therefore delete or fail
  to apply a web guess dismissal stored while labels are off. That needs a desktop SQLite
  migration and a planner change before the flag is on for accounts with a linked Mac.

Platform impact: web implemented; desktop deferred (above); marketing not applicable; future
mobile inherits the resolver. Messaging impact: P-103.

## Alongside audit fixes (Tickets 356–363) — November 26, 2026

Branch `feat/alongside-audit-fixes`, stacked on `feat/alongside-wave5`. No migration. All behind
`CADENCE_ALONGSIDE` / the Mac switch; flag-off behavior unchanged.

- **Estimates:** the Timeline and travel refresh read cached lengths through
  `currentEstimateMinutes`, the brief's own validity rule (recipe-1.3 rows were read as stale).
- **Pairing:** Yes and Accept all refuse a pairing whose host moved, was marked or left
  (`pairing_host_changed`, not counted for Ticket 362); a guest inside an in-progress host
  counts as paired; Re-check and Re-plan keep the coach's evidence; pairing lines and coach
  pairing proposals label guessed inputs (`alongside.pairing-guess`).
- **Free-slot rule:** an all-alongside routine block lasts the sum of its steps; Anywhere
  steps defer to the steps' shared place; schedule-edit conflicts follow the same-place rule
  (`briefMoveConflicts`).
- **Answers:** a question prompt answers only an unanswered Behavior
  (`alongside.answer-already`); web question answers record `alongside_answered`.
- **Mac:** the guesses read runs after each completed sync; export, import and restore follow
  the server's answer like the screens.
- **Docs:** the flag comment, `docs/OPERATIONS.md` and `.env.example` name all seven migrations.
- **Open risk (not fixed):** a released contract-9 Mac that pulls a configuration event naming
  `alongside` fails its export (`normalizeBehaviorConfigurationChangedFields`); the hosted
  projection hides only the Behavior column. Needs an owner decision before
  `20261126220000` is pushed.

## Ticket 363 complete: alongside on Cadence for Mac — November 26, 2026

- **Data:** SQLite schema 29 (`0029_behavior_alongside.sql`), account sync contract 10, writer
  floor 8. Hosted `20261126220000_account_sync_alongside.sql` (not pushed) removes the
  contract-9 exclusions, adds the answer to the configuration snapshot and `changed_fields`
  (constraint replaced, as `20261122010000` did) and registers `(10, behavior, alongside)`.
  Older Macs keep syncing; the server restores the stored answer on their writes.
- **Mac UI (switch `VITE_CADENCE_ALONGSIDE=1`; release and preview builds force it off):**
  form field, Timeline label and overlap cues, row question (`setBehaviorAlongside`), brief
  question opt-in. A linked Mac follows the server flag and reads guesses from the new
  `GET /api/behaviors/alongside`, in memory only. Local mode has no guess.
- **Portability:** Mac exports, BehaviorLog import and restore carry the stored answer with
  the switch on.
- **Not done:** installed acceptance on a dev-signed build (Ticket 365). No build, signing or
  device run in this ticket.

## Ticket 362 complete: pairing the schedule through the coach — November 25, 2026

- **Rule:** `packages/core/src/resolvers/alongside-schedule-pairing.resolver.ts`
  (`planSchedulePairings`, `evaluateSchedulePairing`, `schedulePairingHostHolds`), re-exported
  from `lib/resolvers/`, registered, paired tests. Evidence: today's `done_together` signal
  names the pair, or Yes to the same Daily Brief pairing on 4 local dates in the last 28.
  Guest alongside, host not, places known or guessed and compatible.
- **Days:** both schedules daily or weekly every week; the guest's one set time moves to
  the host's one set time on the shared weekdays only. Every N days, every N weeks, monthly,
  ranges, two times a day and times that differ by weekday are refused.
- **Proposal:** an ordinary base schedule proposal on the coach's tip run (flag on only, at
  most one per run), evidence source `alongside_pairing`. The person sees it in the advisor
  panel and answers Try for two weeks, Change for good or No; a Yes runs
  `updateBehaviorForUser`, so configuration history records it. A host that moved or left
  closes it as `schedule_changed`.
- **Migration:** `20261126210000_alongside_schedule_pairing.sql` drops and re-adds the
  evidence check with the new source (the Nov 20 precedent) and adds one check. Not applied
  anywhere; it needs the owner's yes before a hosted push. Smoke:
  `tests/sql/ticket-362-alongside-schedule-pairing-smoke.sql`.
- **Evals (offline):** `lib/services/advisor-eval/coach-pairing-fixtures.ts`: accept,
  refuse (No and five guards) and no-evidence. No model call.
- **Not done:** the Mac shows the same route's view (Ticket 363 has no work for this).
