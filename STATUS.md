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
| Tickets 356–365: alongside Behaviors and the guessed Where (D33) | 356–362 and 364 complete November 25, 2026 (flag off; hosted migrations `20261125140000`, `20261125150000`, `20261125180000`, `20261125190000` and `20261126110000` not pushed; 360 and 361 add none; `20261126110000` drops and re-adds one check, so it needs the owner's yes); 363 and 365 `not_started`; behind `CADENCE_ALONGSIDE` | Push the additive migrations before the flag goes on anywhere, and `20261126110000` after the owner's yes; the alongside advice card needs a reviewed source (Ticket 360 gap); 363 adds sync, configuration history and the Mac export of the column; the owner decides the Production flag and the Mac release after Ticket 365 | TICKETS, Tickets 356–365; DECISIONS, 2026-11-25 (D33) |
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
| Cadence for Mac 0.1.15 | Published November 24, 2026, 04:49Z (Nov 23, 23:49 EST): schema 28, contract 9, Sub-behaviors (Ticket 349), Advisor avatar (Tickets 343–346), Ticket 341, Ticket 351, PR #369 duration context; real-updater upgrade (`0.1.14` → `0.1.15`) and public readback passed on `test-mac` | 1-hour session renewal & revoked-session check for `@supabase/supabase-js` 2.119.0 deferred; macOS 14 not tested | `docs/qa/2026-11-23-desktop-0.1.15-release-packet.md` |
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
- **Migration:** `20261126110000_alongside_schedule_pairing.sql` drops and re-adds the
  evidence check with the new source (the Nov 20 precedent) and adds one check. Not applied
  anywhere; it needs the owner's yes before a hosted push. Smoke:
  `tests/sql/ticket-362-alongside-schedule-pairing-smoke.sql`.
- **Evals (offline):** `lib/services/advisor-eval/coach-pairing-fixtures.ts`: accept,
  refuse (No and five guards) and no-evidence. No model call.
- **Not done:** the Mac shows the same route's view (Ticket 363 has no work for this).

## Tickets 360 and 361 follow-up: own-channel pairing evidence and the brief "asked" record — November 26, 2026

- **Pairing evidence (361):** new `advisor_read_pairing_evidence(date)`, Daily Brief and
  Chat agent tokens only, returns `done_together` pairs and `crowded_hour` hours for the
  caller's account (today, else yesterday). The brief reads it on its `daily_brief` agent
  client, Chat on its `chat` context. `alongside-pairing.service.ts` no longer mints a coach
  client.
- **Brief asks (360):** new hosted-only `brief_alongside_asks` (ids and a date, owner-only
  RLS, cascades on account and Behavior deletion), written after a saved brief includes the
  question and read for `askedBehaviorIds`; earlier days only, so a same-day refresh may ask again.
- **Migration:** `20261126100000_alongside_pairing_evidence_and_brief_asks.sql`, additive,
  not applied or pushed. Fixture: `tests/sql/alongside-pairing-evidence-and-brief-asks.sql`
  (not yet run). Flag off: nothing new read or written.

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

## Ticket 361 complete: pairing for today in the Daily Brief and Chat — November 25, 2026

- **Planner:** `packages/core/src/resolvers/alongside-pairing.resolver.ts` (`planAlongsidePairings`,
  `planBriefPairingLines`), re-exported from `lib/resolvers/`, registered, 21 resolver tests.
  The target is the host's start and passes the Yes slot check on the guest's side.
- **Daily Brief (flag on):** pairing lines after the move lines, reason code
  `alongside_pairing`, stock words from notice `brief-moves.pairing`, the model told only when
  a pairing line exists (flag off and pairing-free briefs keep the pinned prompt). Re-check and
  Re-plan re-pair or close; Yes is an ordinary move (source `daily_brief`). No migration.
- **Chat (flag on):** tool `plan_alongside_pairings`; the move after the person's yes is
  `move_occurrence_for_day`. `CHAT_ALONGSIDE_INSTRUCTIONS` gains the pairing rule (still `chat-1.8`).
- **Evidence:** the coach's `done_together` and `crowded_hour` signals. Since the November 26
  follow-up, read on the brief's and Chat's own agent tokens through
  `advisor_read_pairing_evidence`, not a coach client.
- **Evals (offline):** brief fixture `alongside_pairing` and rule `pairing_off_host`; chat world
  `alongside_pairing` and scenario `alongside_pairing`. No live or paid eval run.
- **Not done:** the Mac (Ticket 363); the schedule proposal is Ticket 362 (entry above).

## Ticket 360 complete: the agent asks whether a Behavior is alongside — November 25, 2026

- **One rule, one answer:** `alongsideQuestionOpen(behavior, guess)` in `alongside.resolver.ts`
  (not answered and guessed yes). Every answer writes `behaviors.alongside` through the
  Behavior definition service (`lib/services/alongside-answer.service.ts`). No new table, no
  migration.
- **Surfaces (flag on):** Timeline mark-detail line "Done alongside other things? Yes · No"
  after a Completed mark with no Done at line (`MARK_DETAIL_PROMPTS.alongside`, share 0.5);
  one Daily Brief question line (`alongside_question_v1`, `POST /api/advisor/brief/alongside`,
  `pickBriefAlongsideQuestion`, saved with the brief); `setup_gaps` facts
  `alongside_unanswered` and `without_alongside_answer` in `coach-signals-4`; Chat block
  `CHAT_ALONGSIDE_QUESTION_INSTRUCTIONS` in `chat-1.8` (asks only when the answer changes a
  plan in progress; confirmed `update_behavior`); the form's guess note follows the same rule.
- **Gap, advice card:** no tip surface. No source in `advice-library.json` covers doing a
  Behavior alongside other things (`give-it-a-length` rests on Buehler 1994, task-length
  estimates), so the fact ships without a card. A card needs a reviewed source.
- **Brief "once per Behavior":** closed by the November 26 follow-up (`brief_alongside_asks`,
  migration `20261126100000`).
- **Flag off:** no reads, no new line, prompts, signals and brief output unchanged. The web
  client sends `alongside_question_v1`; the server ignores it while off.

Platform impact: web implemented; desktop follow-up Ticket 363 (the shared row and brief
render nothing new without the Mac's action and transport); marketing not applicable;
future mobile inherits the resolver and routes. Messaging impact: `P-093`.

## Ticket 359 complete: advisor readers and the Where guess in the estimate call — November 25, 2026

- **Estimate call:** with `CADENCE_ALONGSIDE` on it is estimate recipe 1.3 (schemas
  `cadence_duration_estimates_v1_3` and `_v1_3_length`): both requests also return
  `whereGuess` (`home`, `anywhere`, `elsewhere`, `unknown`); no new request. A Behavior whose
  Where the person set stores none. Model input is unchanged (title and description).
  Off, instructions and schemas are recipe 1.2, byte for byte (pinned digests).
- **Migration:** `20261125190000_advisor_estimate_where_guess_writer.sql` (`create or replace`,
  same signature): the upsert writes `where_guess` and its `ON CONFLICT` update always sets it.
  Applied locally with every `tests/sql` fixture passing.
- **Readers (flag on):** `readBehaviorPlanningFacts` feeds the day context's `planning` field,
  the Daily Brief consumer (places and the person's answer), Chat (`planning` on timeline and
  Behavior reads, prompt `chat-1.8`, the same-place rule for exact-time opportunity adds) and
  the coach (`coach-signals-4`: `crowded_hour` leaves alongside items out; `done_together`
  facts add `alongside` and `other_alongside`).
- **Evals:** brief fixture `alongside_places` and rule `alongside_other_place`; coach account
  `alongside_evening`; chat world `alongside`, two scenarios and rule `planning_words`.
- **Flag off:** prompts, tool results, day context, stored rows and signals unchanged.

Platform impact: web implemented (no UI change); desktop not applicable (hosted routes);
marketing not applicable; future mobile inherits the server rules. Messaging impact: `P-093`.

## Ticket 358 complete: alongside in the Behavior form and on the web Timeline — November 25, 2026

- **Form:** "Can be done alongside other things" (Not answered, Yes, No) in the create and
  edit forms, with "Cadence guesses Yes/No" and Use the guess while unanswered. Save writes
  `behaviors.alongside` through Ticket 364's plumbing; the parser reads the field only when
  the server action passes `readAlongside` (flag on).
- **Where:** the existing Where suggestion line also states a guessed Where
  (`basis: "guess"`) for a Behavior with Where Not set; Dismiss stores the existing
  dismissal. It rides the Completion places state, so it shows only while labels are on.
  While Details and Settings is open the line sits below Where in the form.
- **Timeline:** rows show "Alongside" or "Alongside · a guess"; Calendar overlap cues stop
  for alongside items (`alongsideMayOverlap`), travel cues stay. One reader,
  `lib/services/alongside-view.service.ts`, serves all three and reads nothing while
  the flag is off.
- **Next:** Ticket 360 wires `alongsideQuestionOpen` into the form; Ticket 363 passes
  alongside data on the Mac. No schema change.

## Ticket 364 complete: alongside in the MCP contract, exports and BehaviorLog — November 25, 2026

- **MCP:** contract 1.8.0 is an edition of the published 1.7.0 registry
  (`packages/core/src/integration/editions.ts`) that the endpoint, errors, validators and
  chat's tool list serve only while `CADENCE_ALONGSIDE` is on. It adds `alongside` (true,
  false or null) to Behaviors and Occurrences and as an optional input on
  `create_behavior` and `update_behavior`. With the flag off `tools/list` is
  byte-identical to 1.7.0 (pinned digest). The generated contract reference and the
  public developer reference stay 1.7.0 until the flag is on for good.
- **Exports:** Full JSON, JSONL, CSV (last column) and BehaviorLog
  (`extensions.app.cadence.alongside`) carry the person's answer; BehaviorLog import and
  restore read it. Off, export bytes are unchanged (pinned digest). The model guess is
  never exported or returned. The BehaviorLog standard has no fitting field; the gap is
  in `docs/EXPORT_FORMATS.md`, "Alongside".
- **Migration:** `20261125180000_alongside_mcp_and_portability.sql` (additive function
  patches: MCP receipt source, BehaviorLog import and restore). Written, not applied
  locally; a static test checks its anchors.
- **Deferred to Ticket 363:** the Mac export, import and restore of the local column,
  account sync and configuration history.

## Ticket 357 complete: effective Where and the same-place overlap rule — November 25, 2026

- **Implemented:** `packages/core/src/resolvers/effective-where.resolver.ts` (`resolveEffectiveWhere`:
  the person's Where, else at least 80% of at least 6 completion place labels in 60 days, else the
  cached guess, else unknown; re-exported from `lib/resolvers/`); migration
  `20261125150000_advisor_estimate_where_guess.sql` (`behavior_advisor_estimates.where_guess`, four
  coarse values, nothing writes it until Ticket 359); `alongsideMayOverlap` in `alongside.resolver.ts`;
  the free-slot rule in `brief-move.resolver.ts` (an alongside item blocks only what the rule refuses);
  `brief-move-day.service.ts` sets each item's `where` with the flag on; Timeline "Move for today",
  brief Yes, Re-check and Re-plan apply it; `daily-brief-consumer.ts` keeps refused findings.
- **Flag off:** no item has a Where, nothing new is read, and alongside items block nothing, as before.
- **Kept as before:** the brief never moves an alongside item; opportunity placements and schedule-edit
  conflict notices have no moving item to compare, so an alongside item still blocks nothing there.
  Calendar events carry no place on the free-slot inputs, so their place is unknown.
- **Boundary:** `tests/effective-where.boundary.test.ts` keeps travel, departure and leave-reminder code
  on `where_kind`.
- **Verification:** `agents:check`, `interactions:check`, `map:check`, `resolvers:check`, `lint`,
  `typecheck`, `test`, `build` passed. Local `supabase db reset` applied every migration (its container
  restart step could not reach the local API from the agent sandbox); all 63 `tests/sql/*.sql` fixtures
  passed, including the new `advisor-estimate-where-guess-smoke.sql`.
- **Next:** push both migrations before the flag is on anywhere; Tickets 358 and 359.

Platform impact: web implemented (no UI change); desktop follow-up Ticket 363; marketing not
applicable; future mobile inherits the core resolvers. Messaging impact: P-093.
