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
| Cadence for Mac 0.1.12 | Published November 19, 2026, 23:34Z (0.1.11 on November 14); brief follow-up passed November 20 | **Linked Macs cannot sync since PR #327 (contract 7, November 20, 04:42Z)**: "The hosted account snapshot fingerprint is invalid." Needs server contract-6 compatibility or a Mac release with contract 7; macOS 14 not tested | `docs/qa/2026-11-19-desktop-0.1.12-release-packet.md`, "Sync failure after PR #327" |
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

## Ended and Paused Behaviors, server and core — November 20, 2026

- **In review (draft PR, branch `claude/project-thread-p37rj8`).** Behaviors no longer
  archive by themselves. `end_date` becomes `end_on` (last day it runs) plus optional
  `end_time`; a single pause (`pause_from_on`, optional `pause_from_time`,
  `pause_back_on`) stops scheduling until the back-on day. Run state is derived by
  `packages/core/src/resolvers/behavior-run.resolver.ts`. Run actions End now, Start
  again, Pause and Resume now write one configuration revision each. The archive job,
  its RPCs and the automatic-archive notices are removed. MCP 1.4.0 adds `run_state`,
  `end_on`, `end_time`, `pause`, the `running` and `not_running` filters, and
  `end_behavior`, `pause_behavior`, `resume_behavior`; `end_date` stays as a deprecated
  alias. Account sync contract 7. Docs: `docs/RECURRENCE_RULES.md`, "Behavior end and
  pause"; `docs/DATA_MODEL.md`, same title; `docs/MESSAGING_CHANGES.md` P-074 to P-076.
- **Verification:** migration replayed on a fresh local Postgres; backfill checked
  (end_date 2026-12-01 became end_on 2026-11-30, `updated_at` unchanged);
  `tests/sql/behavior-end-and-pause-smoke.sql` passes. `npm run test`: 6,304 pass; the 16
  failures are the 4 files that need Node 24 and fail the same way on main here.
- **Production:** migration `20261120120000_behavior_end_and_pause.sql` not applied. It
  needs the owner's OK, and should be applied right before the merge.
- **Next:** web UI (Not running list, End now, Pause, Resume, notices) and Mac
  workstreams. The Mac Rust store still uses `end_date` and must move before the next
  Mac release. The trial-shift rule (T6) belongs to the AI helpers workstream.

## Advisor plan Phase 5 (5A): chat server — November 19, 2026

- **Merged November 20 (PR #318).** `POST /api/advisor/chat`
  streams chat replies as NDJSON events; confirm, Undo and conversation routes sit beside it.
  The turn runs as the person on the `chat` agent token over every MCP operation plus two
  chat-only reads (`list_calendar_events` with event titles, `list_workouts`). Moves are
  checked against calendar events. The first single-record write in a question runs at
  once with Undo; Behavior changes and further writes wait for one Yes (stored in
  `chat_confirms`, 15 minutes). Medical questions get a one-line refusal and the disclaimer.
  Limits: 8 tool calls, US$0.25 per question, 12 KB per tool result, last 20 messages plus
  a summary. Wire types: `packages/core/src/types/chat.ts`. Docs: `docs/DATA_MODEL.md`,
  "Chat conversations"; `docs/ROUTE_MAP.md`.
- **Verification:** `tests/chat-turn.test.ts` (25 tests, scripted model); migration and RLS
  checked on a local Postgres 16 (chat token reads and writes its own rows; the person,
  MCP grants, other agents and other users see none; delete refused; account delete
  cascades). Lint, typecheck and `agents:check` pass. `npm run test`: only the 4 files that
  fail the same way on main in this container. No live run against a real model yet.
- **Production:** migration `20261119230000_chat_conversations.sql` applied November 19 with the owner's OK;
  RLS checked there. Chat model: `openai/gpt-6.1-terra`, effort low (owner's pick from 5D's eval); prompt `chat-1.3` (research claims only from `search_advice` cards; history no longer carries read lines; the medical notice no longer ends the turn).
- **November 20:** chat reads 4F's AI features setting (`readAiSettings`): it answers only after the
  approval while chat is on, and reads only the sources left on.
- Nov 20: `search_advice` added. It searches reviewed (active) advice cards only, so it returns nothing until the owner reviews the 28 draft cards.

## Advisor plan Phase 5B: web Chat page — November 19, 2026

- **In progress (branch `claude/project-thread-0hjpnu`).** First change: "Chat" joins the
  primary navigation after Timeline (`lib/navigation.ts`), with a `/chat` route. Production
  web hides it until the chat server (Phase 5A) is on main and `CHAT_PAGE_LIVE_ON_WEB` is
  set; Cadence for Mac filters it out until Phase 5C. Phase 4E rebases onto this item.
- **Next:** the Chat page on 5A's `@cadence/core/types/chat` events, past conversations,
  mobile layout and a `/design-system` bench with fixture conversations.

## Cadence for Mac 0.1.12 published — November 19, 2026

- **Published 23:34Z** on the owner's instruction of November 19, 21:20Z. Version bump PR #311
  (`afeb8a9e`); notarized (app `10f02d12…`, DMG `e2bc170b…`), 14 artifact checks, quarantined
  download passes. Carries advisor Phase 2 per-day moves on the Mac (SQLite schema 25) and Phase 3
  brief move answers (PRs #303, #306–#310).
- **Upgrade.** With the owner's yes, the test Mac went back to published 0.1.11 with A's protected
  schema-24 database, then updated through the real updater (21:30–21:33Z): schema 24 → 25, no lost
  rows (52 Behaviors, 230 Occurrences).
- **Area checks pass:** session renewal (61 minutes); revoked session (A's Mac session deleted
  22:28Z with the owner's yes, signed-out state 23:30Z, Google reconnect and sync 23:32Z); native
  reminder delivered with Cadence quit. Sign-in and Calendar callback files unchanged.
- **Brief moves on the installed app:** brief opens with move lines, Yes, Undo, Other time kept after
  Close and reopen (`appliedTo`), No and single-line Re-plan pass. Accept all, Undo all and Re-plan
  beside another open line wait for A's first brief of November 20: A used both Refreshes on
  November 19. A's Daily Brief stays on until then.
- **Finding:** a Behavior created with an end date of today is archived at once.

Platform impact: Mac release; web, marketing and mobile not applicable. Messaging impact: none new.

## Advisor plan Phase 4 (4C): base schedule proposals — November 19, 2026

- **In review (draft PR, branch `claude/project-thread-d8ll9x`).** The advisor can propose
  a schedule change when the same Behavior was moved the same way on 4 of the last 5
  matching weekdays: "Change your schedule: Gym at 6:30 PM every Tuesday from Tuesday,
  Nov 24 (now 7:00 AM)." Try for two weeks, Change for good, No; a trial asks Keep or Go
  back after 14 days. Server only for now: table, coach-token proposal function, person
  answer functions, `/api/advisor/coach/schedule-proposal`. 4B's nightly job calls
  `proposeBehaviorChangesForVisit`; 4E draws the lines. Docs: `docs/DATA_MODEL.md`, "Base
  schedule proposals"; `docs/DATETIME_STRATEGY.md`; `docs/ROUTE_MAP.md`. Messaging: none.
- **Verification:** migration applies on a fresh local database and
  `tests/sql/behavior-change-proposals-smoke.sql` passes; unit and service tests pass.
- **Next:** owner go-ahead for the production migration; 4B wires the call; 4E builds the UI.

## Advisor plan Phase 3 (3D): coach signals in shadow — November 18, 2026

- **In review (draft PR, branch `claude/project-thread-vfk26s`).** An hourly cron
  (`/api/advisor/coach/signals/process`, minute 41) visits accounts at 03:00 to 05:59 local
  time that were active in the last seven days, computes coach signals with no model call
  and stores them in `cadence_advisor_private.coach_signals`. Nothing is shown. Signals:
  completion rate dropped, same Behavior moved the same way, late marking, new Behavior past
  two weeks, brief answers. Owner approved the cron and production table on November 18.
  Off switch: `CADENCE_COACH_SIGNALS=off`. Docs: `docs/DATA_MODEL.md`, "Coach signals in
  shadow"; `docs/ROUTE_MAP.md`; `docs/MESSAGING_CHANGES.md` P-064.
- **Verification (local stack):** migration replays on a fresh local database;
  `tests/coach-signals.local-integration.test.ts` passes (due selection, visit as the
  person, re-run, token isolation); resolver, job and route tests pass; lint, typecheck and
  core check pass. `npm run test`: 16 failures in 4 files that fail the same way on main in
  this container (Node 24-only and Preview access suites).
- **Next:** apply the migration to production, merge, and confirm the first hourly runs.
  Answer reading switches to Phase 3A1's `move_proposal_answers` once it exists.

## Advisor plan Phase 1A: data foundations in source — November 16, 2026

- **Merged (PR #290) and applied to the hosted database** on November 16, 2026, with the
  owner's go-ahead. First-party caller (one token channel and first-party grant per agent),
  agent run log with 30-day content store and daily deletion, Postgres spend budget
  (US$5 per account per month; Daily Brief US$0.50 protected, quips US$1.00, Chat
  US$3.50). The hosted Daily Brief now writes a run, reserves before its model call and
  stores its facts and output. Settles Ticket 185. Docs: `docs/DATA_MODEL.md`, "Advisor
  agents"; `docs/COSTS.md`, "Advisor agent budget"; `docs/SUPABASE_WORKFLOW.md`, "Agent
  token channels".
- **Verification (local stack, Node 22):** clean `db reset` replay of all 125 migrations;
  all 49 `tests/sql` fixtures pass (Ticket 232 maintenance smoke now counts the three
  seeded agent clients separately); local integration tests pass except
  `mcp-server.local-integration`, which needs its own assigned stack; `npm run test`
  passes except Node 24-only suites; lint, typecheck, agents, resolvers, core and
  interactions checks pass.
- **Owner decisions:** hosted migrations approved; US$25 global daily breaker confirmed.
- **Phase 1B follow-up (done in #291):** the brief runs through the AI SDK model setting, and its calls still go through `daily-brief-agent-run.ts` over these functions. 1B's stub metering module was removed; `agent-model-pricing.ts` gained the eval candidate prices.

## Advisor plan Phase 1C: ground rules — November 16, 2026

- **Done in a draft PR** (D32). Time helper `packages/core/src/resolvers/time.resolver.ts`
  (now, today, local day bounds, wall-clock times, effective time as planned time) with
  `lib/services/clock.ts`; drift test `tests/scheduled-for-drift.test.ts` with an allowlist
  of the 82 files that mention `scheduled_for` today. `docs/DATETIME_STRATEGY.md` gains
  "Time helper" and "Moves". Shared `AlertNotice` (`components/feedback/`) and its tokens.
  `PRODUCT.md` and `DESIGN.md` follow the advisor plan. `docs/MCP_CONTRACT.md` describes the
  deprecation path. Public text logged as P-059 to P-061.
- **Verification:** lint, typecheck, build, `agents:check`, `interactions:check`,
  `resolvers:check` and `core:check` pass. `npm run test`: 16 failures in 4 files
  (`mcp-fixture-cleanup`, `mcp-hosted-fixtures`, `mcp-hosted-isolation`,
  `public-trust-input`), identical on `main` in this environment (Node 22).
- **Deferred:** dropping "Suggestions never change the record" from
  `briefing-references.json` changes the pinned production prompt
  (`tests/daily-brief-production-pin.test.ts`); it moves to Phase 3 with the new prompt.

## Cadence mailbox on Microsoft 365 — November 14, 2026

- **Done** on the owner's approval (07:19Z). `cadence-me.com` is an accepted domain (not the
  default) in Identity Scaffolding's Microsoft 365 tenant. Shared mailbox "Cadence"
  (`hello@`, aliases `login@` and `support@`), no licence; the admin user has Full Access
  and Send As. Microsoft DKIM signing on (status Valid).
- **DNS (Cloudflare):** added the `MS=` verification TXT, MX, autodiscover and the two
  Microsoft DKIM CNAMEs; SPF now includes Microsoft and Sequenzy. Sequenzy DKIM,
  return-path and DMARC (`p=none`) unchanged. Before/after table and undo steps:
  `docs/OPERATIONS.md`, "Cadence mailbox (Microsoft 365)".
- **Verification:** `docs/qa/2026-11-14-cadence-mailbox.md`. Inbound to all three
  addresses, reply as `hello@` (SPF, DKIM `selector1`, DMARC pass), Sequenzy reminder (SPF,
  DKIM `sq1`, DMARC pass), Sequenzy into the tenant (Inbox, not Junk) and public DNS all
  passed. Hosted Auth SMTP read unchanged.
- **Open:** sending from the `login@`/`support@` aliases is off (tenant-wide setting).
  P-058: the Privacy page's 12-month Microsoft 365 retention claim does not cover the new
  mailbox yet.

## Cadence for Mac 0.1.11 published — November 14, 2026

- **Published 06:14Z** on the owner's instruction of November 13, 21:45Z. Version bump PR #276
  (`78b7c785`); notarized (app `0dda6171…`, DMG `5038ad63…`), 14 artifact checks, quarantined
  download passes. Carries Ticket 336, the dormant ChatGPT-plan code (PRs #240, #241, #243),
  Ticket 330 and PR #247's error text.
- **Upgrade.** With the owner's yes, the test Mac went back to published 0.1.10 with A's
  protected database (owner row 15), then updated through the real updater (01:46–01:53Z):
  schema 24, no lost rows, `launchSyncChanges` baseline 1 and cursor 1.
- **Area checks pass:** sign-in and Calendar callback replay; renewal after 62 minutes; revoked
  session (A's Mac session deleted 05:00Z with the owner's yes, signed-out state at 06:04Z,
  Google reconnect and sync at 06:14Z). 1Password rate-limited the token from 01:57Z to about
  05:00Z, which held the download link until then.
- **Ticket 336 on production:** method list (Google, Apple, email), email link on a clean profile
  with an AgentMail address, the different-account guard and Google reconnects of A pass; both
  email test accounts deleted. Apple skipped by the owner. A first link of A still fails on the
  branched-history defect. Record: `docs/qa/2026-11-13-desktop-0.1.11-release-packet.md`.

Platform impact: Mac release; web, marketing and mobile not applicable. Messaging impact: none
new (P-051).

## Tickets 338–340: sign-in limits per person, live — November 14, 2026

- **Turned on, 01:42–01:44Z**, under the owner's 01:34Z approval: hosted Auth
  `security_sb_forwarded_for_enabled` true; Vercel Production `CADENCE_TURNSTILE_SECRET_KEY`
  (vault `turnstile-secret-key`) and `SUPABASE_SECRET_KEY` (the existing `default`
  `sb_secret_` key, read in memory through the Management API), both sensitive; production
  redeployed. No new key.
- **Checks.** Without the secret key the header is ignored (31st call 429). Forwarding
  confirmed live with the agent's own address before any attack-style check. Email code,
  link in a second browser, the Mac's email page, no-token refusal (no email), Change
  address and Add Google/Apple on a throwaway, A's Calendar unchanged. Two networks (test
  Mac as attacker): wrong codes, made-up refresh cookies and made-up callback codes limited
  only the test Mac; this Mac signed in, refreshed and signed in with Google meanwhile.
- **Measured.** A secret key with a user's bearer answers as the user and the `/user` limit
  follows the header: Change address can be forwarded (needs a ticket).
- **Logs** 01:44–02:02Z: every 5xx was this run's own test Mac probe. Record:
  `docs/qa/2026-11-13-ticket-338-email-rate-limit.md`, section G.

Platform impact: web and the Mac's email page; Mac app code entry unchanged. Messaging impact: none new (P-055 to P-057 stand).

## Reminder email sender renamed to Cadence — November 14, 2026

- **Applied 01:48Z** with the owner's approval (01:46Z): Sequenzy sender profile
  `oqf1lrv9mmvxjkj8admg39cv` in company Identity Scaffolding renamed from "Identity
  Scaffolding" to "Cadence" through the API. Address, Reply-To, tracking, footer, plan and
  templates unchanged.
- **Checked.** One `habit-reminder` test to AgentMail arrived From
  `Cadence <hello@cadence-me.com>`; SPF, DKIM and DMARC pass. Sign-in email still sends as
  `Cadence <login@cadence-me.com>` (hosted Auth SMTP read back, no email sent).
- Record: `docs/qa/2026-11-13-ticket-332-hosted-auth-changes.md`, go-live table.

Platform impact: web (hosted reminder email sender name); desktop sends no email; marketing and future mobile
not applicable. Messaging impact: none.

## Ticket 340: sign-in callback limits per person, fixed inactive — November 14, 2026

- **Audit.** Every server-side Supabase Auth call, with its limit bucket and caller:
  `docs/qa/2026-11-13-ticket-340-auth-call-limits.md`, section A. Per address and not
  forwarded: the callback's code exchange (`/token`, `pkce`), the same on link returns,
  and refreshes by the cookie client outside the proxy. Change address (`PUT /user`) is
  per address too; deferred to a hosted measurement.
- **Fix (branch `claude/sign-in-auth-call-limits`).** Under Ticket 338's rule the cookie
  client sends the secret key and the person's address on those `/token` calls only. On a
  local Auth copy, 31 made-up codes from one address no longer block another person's
  sign-in; the same test fails on the code before the fix. Unset: unchanged. The proxy
  now keeps a refreshed cookie when a later JWKS read fails.
- **Verified and merged.** An independent verifier passed it (QA record, section F),
  then PR #281 merged.
- **Hosted: nothing changed.**

Platform impact: web only (Ticket 340). Messaging impact: P-057.

## Ticket 339: session refresh no longer signs people out — November 13, 2026

- **Reproduced.** Local Auth copy with hosted limits, Cadence before the fix: 24 loads of
  `/timeline` with a made-up expired cookie used up the `/token` burst; the next person's
  refresh got 429 and Cadence cleared their cookie and redirected to `/login`.
- **Fix (branch `claude/sign-in-refresh-rate-limit`).** The last Auth answer decides:
  400–404 end the session as before; 429, 5xx or no answer keep the cookie and return 503
  with `Retry-After: 5`. The refresh call alone carries the secret key and the person's
  address when both Ticket 338 variables are set and `VERCEL=1` (the Vercel check now
  also applies to Ticket 338). After: no forwarding, the victim keeps the session and
  refreshes within seconds; with forwarding, the victim refreshes at once. Added proxy
  time about 1 µs at p50.
- **Hosted: nothing changed.** QA record:
  `docs/qa/2026-11-13-ticket-339-session-refresh-rate-limit.md`.
- **Merged** as 94220cb1 (PR #279), after a verifier pass (QA record, section H). On
  production: kept sessions A and B load `/timeline` and `/api/export/json`; a forced refresh
  of A's session got 200 and a new cookie; a made-up expired cookie gets 307 to `/login` with
  the cookie cleared; a fresh Google sign-in and a sign-out as A, and one email sign-in by code
  (account deleted after), work. No 503 in production requests in the 20 minutes after the
  deploy. Open: the callback's code exchange shares the refresh limit.

Platform impact: web only (Ticket 339). Messaging impact: P-056.

## Ticket 338: email sign-in limits shared by everyone, fixed inactive — November 13, 2026

- **Measured.** Supabase Auth limits `/otp` and `/verify` per IP address; Cadence calls both
  from its server. On a loopback copy of hosted limits, 31 wrong codes from one address
  made another address's right code fail (`over_request_rate_limit`), and 29 email requests
  from one address refused the next person on the web form and the Mac's page. A test
  deployment called out from 2 addresses in 20 calls. Hosted Auth logs are not readable
  through the API. Hosted CAPTCHA is skipped for a secret key (3 harmless probes).
- **Fix (branch `claude/sign-in-email-rate-limit`).** With `SUPABASE_SECRET_KEY` and
  `CADENCE_TURNSTILE_SECRET_KEY` set, Cadence runs the Turnstile check itself and sends the
  person's address in `Sb-Forwarded-For` for the email request, code and link checks and
  the Mac's email page. Unset: unchanged. After the fix the second person signs in and the
  first stays limited; no token, no email.
- **Hosted: nothing changed.** Change list for a verifier:
  `docs/qa/2026-11-13-ticket-338-email-rate-limit.md`, section D.

Platform impact: web and the Mac's email page (Ticket 338). Messaging impact: P-055.
