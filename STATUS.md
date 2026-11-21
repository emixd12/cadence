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
| Tickets 331–337: sign-in by email and Apple (D31) | 331–335 complete. Email (`CADENCE_SIGN_IN_EMAIL`, 21:35Z), Apple and Settings sign-in methods (`CADENCE_SIGN_IN_APPLE`, `CADENCE_SIGN_IN_LINKING`, 21:36Z) **live on production web** since November 13, 2026; hosted migrations equal git; final production check passed November 13, 22:05–22:20Z. 336 published in Cadence for Mac 0.1.11 (November 14, 06:14Z; release packet). 337 web rows done | 337: acceptance row 6 on the installed 0.1.11 (each method links, syncs, refuses a second account); row 3's Apple half (a Google account adds Apple, then signs in with it: needs the owner's Apple Account). Follow-ups: next row | TICKETS, Tickets 331–337; DECISIONS, 2026-11-13 (D31); `docs/qa/2026-11-13-sign-in-final-verification.md` |
| Sign-in follow-ups (from the November 13 final check) | Open, none blocks users today | (1) Done November 14: reminder email sender renamed from "Identity Scaffolding" to "Cadence" (next entry). (2) Done November 14: replies to `hello@`, `login@` and `support@cadence-me.com` reach a Microsoft 365 shared mailbox (next entry). (3) Sequenzy open tracking on (pixel in sign-in email). (4) SMTP key is full access; a `transactional_sender` key would do. (5) Turnstile widget allows `localhost` and `127.0.0.1`. (6) Test login host check passes from the LAN under `next dev`. (7) First link refused for branched status history (`account-sync.resolver.ts:821`; proposed workspace). (8) After a refused CAPTCHA the email form clears the typed address. (9) Shared per-IP OTP and verify limits: fixed and live under Ticket 338 (next row). (10) 32 acceptance OAuth clients and the `localhost` redirect entries remain on production. (11) Token refresh in `proxy.ts` shared one per-address limit and a refused refresh signed people out: fixed and live under Ticket 339 (next row) | `docs/qa/2026-11-13-sign-in-final-verification.md` |
| Tickets 338–340: sign-in limits per person | **Live in production since November 14, 2026, 01:44Z.** Hosted `security_sb_forwarded_for_enabled` on; Vercel Production `CADENCE_TURNSTILE_SECRET_KEY` and `SUPABASE_SECRET_KEY` (existing `default` key) set, owner-approved 01:34Z. Two-network checks passed for wrong codes, refresh and the sign-in callback | Follow-up ticket needed: forward Change address (`PUT /user`); hosted measurement shows it works. Remove-a-method check not run (no spare provider account) | TICKETS, Tickets 338–340; `docs/qa/2026-11-13-ticket-338-email-rate-limit.md`, section G |
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
| Cadence for Mac 0.1.14 | Published November 21, 2026, 06:36Z (0.1.13 at 01:59Z): schema 27, contract 8, Behaviors of Opportunity; real-updater upgrade and Opportunity round trip passed on the test Mac | Owner signs Cadence on the owner's Mac in to check contract 8 sync there; earlier linked Macs cannot sync until they update; macOS 14 not tested | `docs/qa/2026-11-21-desktop-0.1.14-release-packet.md` |
| Ticket 285: installed Mac acceptance | Run November 6–7, including Calendar-event activation on published 0.1.9 | Closure not stated: unclear — see source; user guide line for `P-027` still to add | TICKETS, Ticket 285; STATUS, "Ticket 285 defect fixed: blank Mac window from the archive notice — November 7, 2026" |
| Ticket 284: web acceptance with the real clock | Evidence recorded, awaiting verification; seven findings fixed on `travel-wave6` (merged as PR #196 per `git log`) | Verification of the evidence and fixes; Ticket 283 Outlook or iCloud routed event not checked (no test connector) | TICKETS, Ticket 284; STATUS, "Travel advisory revamp Wave 6: Ticket 284 web acceptance with the real clock — November 6, 2026" |
| Travel revamp Tickets 260–283 | Merged as PRs #189–#194 and #196, November 5–7, 2026; live on web; Mac parts released in 0.1.9; hosted equals git, so the 275–277 migrations are applied; TICKETS reconciled November 11, 2026 | Release acceptance continues under Tickets 165, 284 and 285; production setting of `CADENCE_LEAVE_REMINDER_JOB` not checked | TICKETS, Tickets 260–283; STATUS, "Ledger cleanup — November 11, 2026" |
| Ticket 165: travel release acceptance | In progress | Denied state; installed Open Location Services and Check again; installed status-only permission regression. Directions matrix: web rows in Ticket 284, installed Mac row in Ticket 285 | TICKETS, Ticket 165; STATUS, Ticket 284 and Ticket 285 entries (November 6–7) |
| Ticket 187: agentic Calendar access | Live since October 24, 2026 | Google sensitive-scope verification (Ticket 245); published Mac against the 187 server; installed desktop consent; `P-012` | TICKETS, Ticket 187 |
| Launch narrative follow-ups (D30, Ticket 327 complete) | `docs/NARRATIVE.md` accepted November 13; positioning is "behavioral remodeling assistant"; no public copy changed | Owner decides the beta audience from the Ticket 328 report and approves interviews; the marketing site rewrite (P-048), listings, visual identity and the social system each need a ticket; claims table not checked against production | TICKETS, Ticket 327; DECISIONS, 2026-11-13 (D30); P-048 |
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
| Connector Tickets 236, 240–242 (Hevy, iCloud, Outlook) | Hevy, Outlook (personal account) and iCloud (owner's Apple Account) passed on production web and installed Mac 0.1.10 (November 11–12); cross-tenant Outlook checks skipped by owner decision | Not verified on production: an iCloud event on Timeline (no events in the selected calendars), the Outlook `cadence://` completion, sign-out and account-switch cache cleanup, Hevy key entry on the Mac. Owner revokes the "Cadence QA" app-specific password when testing ends. 241 step 7 copy is live and awaits the owner's review | TICKETS, Tickets 236, 240, 241, 242; STATUS, "iCloud production acceptance — November 12, 2026" |
| Tickets 243–244: travel backlog | Filed October 22; backlog | None scheduled | TICKETS, Tickets 243–244 |
| Daily Brief release acceptance (grouped): Tickets 147, 148, 155, 161, 168, 169, 172, 173, 174, 182, 183, 185 | In progress or implemented in source; reconciled October 27: still open | Ticket 174 carries hosted, deployed-web and installed-desktop gates; 182–183 owner-run live checks; 185 awaits owner product decisions | TICKETS, Ticket 174 and each listed ticket |
| Google Calendar Timeline (grouped): Tickets 133–137, 141, 150 | In progress; reconciled October 27: still open | Post-approval web and native consent smoke checks; 137 provider-failure, Workspace and installed fixture cases; 150 live custom-name check | TICKETS, Tickets 137, 141, 150 |
| Earlier travel tickets (grouped): 160, 162–164, 166, 167, 170, 171 | Implemented in source or discovery complete | Release gates sit in Tickets 165 and 174; owner re-acceptance for 166–167 | TICKETS, each listed ticket |
| Desktop release follow-ups (grouped): Tickets 142, 143 | Complete in source; web deployed September 18 | Installed-native release acceptance | TICKETS, Tickets 142–143 |
| Operations (grouped): Tickets 091, 104, 105, 128 | 091 and 105 in progress; 104 and 128 blocked; reconciled October 27 | 104: operator diagnostics or an authorized route test; 105: verify deployed browser-push delivery after the reviewed web-push 4.0.0 upgrade; 128: a revised candidate needs a new measured gate | TICKETS, Tickets 091, 104, 105, 128 |

## Recent entries

## Behaviors of Opportunity, web, MCP, Daily Brief and Mac — November 21, 2026

- **Merged (PR #351, `07fb29ea`) and live; the Mac part shipped in Cadence for Mac 0.1.14
  (November 21, 06:36Z).** A Behavior can be available as an
  opportunity, with or without a schedule; the person adds it to today from the Timeline's
  Opportunity Basket (a time, a window or Done now) and removes a clean added item.
  Adherence stays scheduled-only; unscheduled ones show Done N times. Five waves:
  Postgres, core rules and sync contract 8; web form, list, basket and rows; MCP 1.6.0
  and Chat; Daily Brief "Add for today" lines and the `opportunity_ready_to_schedule`
  coach signal; Cadence for Mac (SQLite schema 27 rebuilds `behaviors` and `occurrences`,
  local add and Remove, contract 8 sync, the brief lines on a linked Mac).
- **Hosted migrations applied before the merge:** `20261121100000`, `20261121110000`,
  `20261121120000`, `20261121130000`.
- **Verification (Node 24):** `cargo test` (Rust store, incl. 26 → 27 upgrade, add, Done
  now, Remove, generation guard, contract 8 round trip); real-SQLite
  `tests/desktop-opportunity-contract.test.ts`; DOM and service tests for each wave;
  typecheck (web and Mac), interactions, map, resolvers, core and agents checks. Not run:
  full `npm run test`, SQL replay (CI "Local Supabase rehearsal").
- **Done:** contract 8 has no contract 7 fallback, so linked Macs need 0.1.14 to sync.

Platform impact: web implemented (Tasks 3–7); desktop implemented (Task 8,
`apps/desktop/src/local-opportunity.service.ts`, `local_store/opportunity.rs`); marketing
not applicable; future mobile deferred (no ticket). Messaging impact: P-078, P-079, P-080.

## Sub-behaviors and Timeline Semantic Zoom (Ticket 343) — November 21, 2026

State: implemented on branch `feature-create`, rebased on `origin/main` `39a6911a`
(after PR #351 Behaviors of Opportunity and Mac 0.1.14); not merged, not deployed.

- Scope: routines (depth-1 sub-behaviors), schedule inheritance, leaf Occurrences,
  routine slot marks, Timeline Semantic Zoom, MCP contract 1.7.0, Chat `chat-1.6`,
  Daily Brief routine moves, `coach-signals-3` (`sub_behavior_dropoff`),
  `coach-tips-3`, portability, Hevy completion on routines, and Mac parity (SQLite
  0028, account sync contract 9; the minimum writer contract stays 8, so Mac 0.1.14
  keeps syncing). Docs: TICKETS, Ticket 343; DECISIONS, 2026-11-21.
- An opportunity Behavior is never part of a routine: it cannot be a parent or a
  sub-behavior (resolver, database trigger, SQLite 0028 triggers, MCP and form).
- Mac Daily Brief routine moves: Yes, Other time, Undo, Accept all and Undo all on a
  routine line, through the hosted route and account sync. Advice card
  `smaller-step-in-the-routine` is active (owner review 2026-11-21; library
  `2026-11-21.2`).
- Registry: `INT-BEHAVIOR-039`–`045` and `INT-TIMELINE-025`–`027`, implemented on web
  and desktop. Notice `sub-behaviors.routine-marked`. Messaging: P-081–P-083.
- Hosted migrations pushed November 21, 2026 (owner-authorized): `20261122010000_sub_behaviors`,
  `20261122020000_sub_behavior_portability_connectors`,
  `20261122030000_coach_signal_sub_behavior_dropoff`. `migration list`: 151 local, 151
  hosted, identical.
- Verification (after the rebase): `dagger check --cadence` 11/11; `core:check`,
  `desktop:typecheck`, `marketing:build`, `marketing:check`; `cargo test` 180;
  `desktop:contract:test` 24; SQL: PR #351's four migrations plus ours and ten smokes
  (sub-behaviors, portability, opportunity, account sync, end and pause, tickets 060,
  314, 321) pass in one rolled-back transaction. Local-integration on a migrated local
  stack: 9 files, 73 of 74 tests pass (sub-behaviors MCP, brief moves, occurrence move,
  integration read, write, idempotency and request context, tips one-tap, coach
  signals); `smoke:rls` 92 checks and the account sync smoke (now checks contract 9)
  pass. The one failure is pre-existing on `main`: the coach-signals test expects
  `brief_answers` signals and gets `setup_gaps`. Fixed here: the coach reminders read
  named two foreign keys (PGRST201 on every call since #315). Not run: installed Mac
  acceptance (Task 13).
- Phone width: the routine title keeps the row's width; the two marks wrap below it.
- Open:
  1. Coach-signals local test: `brief_answers` expectation is stale on `main`.
  2. Mac: routine reminder text names the anchor step, not the routine. Installed Mac
     acceptance not run.

## Product map, features and journeys — November 20, 2026

- **In review (draft PR, branch `claude/project-thread-t00ue8`).** Build step 1 of the
  product map and notices library plan (owner decisions of November 20, 2026).
  `scripts/build-product-map.mjs` joins the registries into one deterministic graph:
  journeys, 35 features, interactions, components, families, tokens, ontology terms,
  database tables, MCP tools, services and API routes (`docs/PRODUCT_MAP_GUIDE.md`).
  `npm run map:check` runs in CI and Dagger; `npm run map -- <id>` shows one item.
- Interaction registry 1.4.0 adds `features` and a required `feature` on every
  interaction. Journeys: J03 is now Sign-in; J23 to J28 added (calendars, Hevy, Daily
  Brief, travel, completion places, AI apps); J14 keeps only its 3 timezone actions.
- 18 component descriptions and the canonical token descriptions filled in; token
  values unchanged.
- Build step 2, the notices library: 99 notices in `packages/core/src/notices/catalog/`
  (moves, Daily Brief, brief move lines, Timeline reload, Mac reminder lines, Ended and
  Paused form errors and its 3 Timeline notices from PR #328).
  `<Notice>` (`components/feedback/Notice.tsx`) draws the four styles; web, Mac and the
  server read the words from the catalog. Restyled to the November 19 text styles: move
  confirmations italic, Timeline row refusals and brief load errors as one Rust Signal
  line, the reload line by result. `docs/NOTICES.md` (committed, checked) lists every
  notice and the 39 changes. A new `advisor-tips` feature holds the Timeline advisor
  interactions from #321, and `chat` holds the Chat page from #325, whose journey is J29 (35 features).

## Tips with one-tap changes — November 20, 2026

- **In progress (branch `claude/project-thread-wg2oqh`, draft PR).** A tip can carry a
  schedule or length question that Cadence writes ("Set Gym to 6:30 PM every day?"). The
  offer uses the tip's bar: 3 same-direction moves in 28 days, targets within 60 minutes,
  a shift of at least 30 minutes; moves on one weekday change that weekday, on 2 or more
  every day at that set time. Length changes round to 5 minutes. A Yes applies today when
  today's Occurrence is ahead and unmarked; a day moved by hand keeps its move. Undo
  follows Change for good. No answers the tip Not now and rests the card 30 days for that
  Behavior. One open proposal per Behavior. Offer cards at revision 3, seeds without
  questions. Tip links open the Behaviors editor at a field (web `/behaviors?edit=&field=`,
  the Mac in app) or Needs decision. New interaction `INT-ADVISOR-005`.
- **Migration:** `20261120160000_tips_one_tap_changes.sql` (owner approved as reviewed).
- **Verification:** unit tests for the core proposal rules, the proposals service, the tips
  writer and job, the advice library and the advisor DOM; `tests/sql/tips-one-tap-changes-smoke.sql`
  and `tests/tips-one-tap.local-integration.test.ts` on an isolated local Supabase (a Yes
  moves today's item and Undo puts it back; a day moved by hand keeps its move, no second
  copy). Lint, typecheck (web and Mac), `interactions:check`, `resolvers:check` and build
  pass. `npm run test`: only the 4 files that fail the same way on main in this container
  (Node 22, no Preview access).

## Cadence for Mac 0.1.14 published — November 21, 2026

- **Published 06:36Z** under the owner's full approval for this release (Task 11). Version bump
  PR #352 (`e3b87963`); notarized (DMG `0a78310d…`), 14 artifact checks, quarantined download
  passes, public readback passes. Area checks: none triggered; check 4 ran for migration 27.
- **Test Mac:** published 0.1.13 updated through the real updater; schema 26 → 27, every table
  kept its count, contract 8 sync with 0 pending. A new opportunity Behavior and a Done now
  Occurrence from the Basket synced and read back in hosted data as A.
- **Owner's Mac:** 0.1.13-dev.1 → notarized 0.1.14 by rename swap after a protected backup;
  schema 27, no rows lost. It has no account linked (149 local writes), so contract 8 sync
  there waits for the owner's sign-in.
- **Tooling findings:** the `click` helper refuses when the Dock's full-screen layer-20
  window covers the point; the test-Mac permission probe times out (one accessibility read
  takes 85–100 s). Test Mac Location is not allowed (owner step).

## Cadence for Mac 0.1.13 published — November 21, 2026

- **Published 01:59Z** on the owner's instruction of 01:13Z. Version bump PR #347 (`5c7490b6`);
  notarized (DMG `503b6287…`), 14 artifact checks, quarantined download passes, public readback
  passes. The test Mac went back to published 0.1.12 (owner's yes) and updated through the real
  updater; the 7-conflict review applied on the published build and the 11 old writes synced.
  The upgrade checker flagged 5 Occurrences that sync removed (archived on the web); classified
  in `docs/qa/2026-11-21-desktop-0.1.13-release-packet.md`.
- **Release check on dev builds, November 20–21.** Dev-signed 0.1.13-dev.1 (main
  `6d0f6834`) installed on the owner's Mac (schema 24 → 26, counts unchanged) and the test
  Mac (schema 25 → 26; 30 `end_date` rows backfilled as `end_on = end_date - 1`; 11 pending
  writes kept). Migration 26 passes on both.
- **Finding, fixed on this branch:** the test Mac's sync stopped at "Review 7 sync
  conflicts". Both sides had archived the same Behaviors and each appended its own
  configuration event. Applying either choice failed with "references missing
  configuration_event". `resolveReviewedAccountSync` now copies the rows a reviewed winner
  newly references from its own side. The bug dates from Tickets 116–122, not Ticket 342.
- **Verified with 0.1.13-dev.2 (PR #342) on the test Mac, November 21, 00:20–00:58Z:**
  "Use account version" for all 7 applied; sync completed with 0 pending and the 11 writes
  reached hosted (71 Behaviors, Occurrences 244 → 247). On a throwaway Behavior, End now
  (ends at the next minute, today's later row removed, "Not running (1)", "Ended Nov 20,
  7:38 PM"), Start again from the Timeline notice, Pause with back-on Nov 24 ("Paused, back
  Nov 24", no Occurrences Nov 20–23) and Resume now from the Timeline notice each synced
  and read back in hosted data. The throwaway Behavior is archived. The web page itself was
  not read: the QA Chrome profile refused a debugger attach.
- **Open:** a reviewed winner that references a Category the other side deleted still
  fails the same way (needs a product decision).

Platform impact: web and desktop share the resolver (desktop runs reviewed sync); marketing
and future mobile not applicable. Messaging impact: none.

## Ended and Paused Behaviors, Mac (Ticket 342) — November 20, 2026

- **In review (draft PR, branch `claude/project-thread-vwbetq`, stacked on the web PR).**
  SQLite migration 0026 replaces `end_date` with the five run columns (backfill
  `end_on = end_date - 1`). Row checks, contract 7 sync fields, the configuration snapshot
  (`end`, `pause`), the generation guard and the timezone re-expression (T1) match the
  server. The Mac wires the shared Not running group, run controls and Timeline notices to
  a local `runAction`.
- **Verification:** 167 Rust store tests; `tests/desktop-run-actions.test.ts`,
  `tests/desktop-run-ui.dom.test.tsx`; desktop and web typecheck.
- **Next:** Cadence for Mac 0.1.13 after the server PR merges; publishing needs the
  owner's written OK.

## Ended and Paused Behaviors, web — November 20, 2026

- **In review (draft PR, branch `claude/project-thread-8l6iw2`, stacked on the server and
  core PR).** Behaviors list: a Not running group (open by default, hidden when empty) with
  "Ended Nov 30" or "Paused, back Dec 8" and Start again or Resume now plus Archive; grey
  notes on running rows for an upcoming end or pause; End now, Pause and Cancel pause under
  "When it runs" in Details and Settings. `PauseRangePicker` (first paused day, then back-on
  day). Form: "Ends after" with "Set a time" and "End of day instead". Timeline: three
  closable notices (`BehaviorRunNotices`), Close remembered per device per day. Shared
  components take an injected `runAction`, so the Mac (Ticket 342) wires local actions.
  Interactions INT-BEHAVIOR-033 to 036 and INT-TIMELINE-020; messaging P-077.
- **Verification:** `tests/behavior-run-ui.dom.test.tsx` (9 tests); typecheck; lint of
  changed files; `interactions:check` passes. Full `npm run test`: 6,324 pass; the 16
  failures are the Node 24 files that fail the same way on main here.
- **Left for AI helpers:** the trial warnings before End and Pause (R3, `in_trial`).
