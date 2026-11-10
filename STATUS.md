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

Compiled November 9, 2026. Check the cited entry before acting on a row.

| Ticket or area | State | Next action or blocker | Source |
| --- | --- | --- | --- |
| Ticket 292: day notes | Web, MCP (contract 1.1.0) and Mac app (local and sync contract 3) in source on branch `note-add`; not merged or deployed | Day-note shortcuts, BehaviorLog restore/import, MCP `search`/`fetch`, installed Mac acceptance, then hosted migrations with owner authorization | TICKETS, Ticket 292; STATUS, "Ticket 292: day notes in progress — November 10, 2026" |
| Ticket 293: test-access preflight | Merged November 10, 2026; awaiting verification | First live preflight run per suite | TICKETS, Ticket 293; STATUS, "Ticket 293: test-access preflight for acceptance runs — November 7, 2026" |
| Tickets 289–290: Daily Brief prompt, model and effort candidates | Candidates in the development workbench; production pinned | The owner compares candidates on the reserved cases and promotes or rejects one under Ticket 184's rules | TICKETS, Tickets 289–290; `docs/qa/daily-brief-prompt-consolidation.md` |
| Ticket 291: skill-rule acceptance scenarios | Unit-tested with fakes | First local-stack or live run with a real client | TICKETS, Ticket 291; `docs/qa/mcp-server.md`, "Skill-rule scenarios — Ticket 291" |
| Ticket 288: Daily Brief token usage | Recorded per call in the performance log and workbench runs | Measure with `CADENCE_PERF_LOG=1` and replace the assumed figures in `docs/COSTS.md` | TICKETS, Ticket 288 |
| Leave reminder send-time Calendar read (follow-up) | Entry says "not pushed"; `git log` shows PR #200 merged as `2d16bf12` | Deployment not recorded: unclear — see source | STATUS, "Follow-up: keep a leave reminder when the send-time Calendar read fails — November 8, 2026" |
| Behavior place edit withdraws its leave time (web) | Entry says "not pushed"; `git log` shows PR #198 merged as `d643a6e7` | Not yet rechecked live | STATUS, "Follow-up after the Wave 6 deploy: a Behavior place edit withdraws its leave time — November 7, 2026" |
| Mac leave reminders for newly added Calendar events | Entry says "not pushed"; `git log` shows PR #198 merged | Not yet rechecked on an installed Mac | STATUS, "Follow-up after Mac 0.1.9: reminders for newly added Calendar events — November 7, 2026" |
| Cadence for Mac 0.1.9 | Published November 7, 2026 | macOS 14 not tested; 0.1.8 users with an auto-archived Behavior must download 0.1.9 | STATUS, "Cadence for Mac 0.1.9 published — November 7, 2026" |
| Ticket 285: installed Mac acceptance | Run November 6–7, including Calendar-event activation on published 0.1.9 | Closure not stated: unclear — see source; user guide line for `P-027` still to add | TICKETS, Ticket 285; STATUS, "Ticket 285 defect fixed: blank Mac window from the archive notice — November 7, 2026" |
| Ticket 284: web acceptance with the real clock | Evidence recorded, awaiting verification; seven findings fixed on `travel-wave6` (merged as PR #196 per `git log`) | Verification of the evidence and fixes; Ticket 283 Outlook or iCloud routed event not checked (no test connector) | TICKETS, Ticket 284; STATUS, "Travel advisory revamp Wave 6: Ticket 284 web acceptance with the real clock — November 6, 2026" |
| Travel revamp Tickets 260–283 | TICKETS `Status:` lines say "on branch `us-work`, not merged or deployed"; entries record Waves 1–2 deployed and `git log` shows PRs #192–#196 merged | Reconcile the `Status:` lines; hosted migration state of Tickets 275–276: unclear — see source | TICKETS, Tickets 260–283; STATUS, "Travel advisory revamp Wave 1 deployed — November 5, 2026" and "Travel advisory revamp Wave 2 deployed — November 5, 2026" |
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
| MCP Tickets 220–231 | TICKETS `Status:` lines still say filed, planned or awaiting review (October 18); MCP is live and Ticket 232 acceptance is complete | Reconcile the `Status:` lines: unclear — see source | TICKETS, Tickets 220–232; STATUS, "Ticket 232 live acceptance complete — October 31, 2026" |
| Ticket 232: MCP production acceptance | Live acceptance complete October 31 | One Trust marketing-ID refresh and a Trust Preview → Production run after the record merges; done or not: unclear — see source | STATUS, "Ticket 232 live acceptance complete — October 31, 2026" |
| Ticket 259: consent offers write permissions | Merged October 31 as PR #175 | TICKETS says live ChatGPT write acceptance remains; the entry records a Tier 2 ChatGPT web run that completed the write: unclear — see source | TICKETS, Ticket 259; STATUS, "Ticket 259: consent offers advertised write permissions — October 31, 2026" |
| MCP acceptance tooling, Tickets 247–258 | Entry: complete except Ticket 253 (on hold); TICKETS still lists 252 in review and 256 planned | Reconcile 252 and 256; consent Allow or Deny before hydration returns 500 (product finding, not fixed) | STATUS, "Automated MCP client acceptance: Tickets 247–258 — October 31, 2026"; TICKETS, Tickets 252–256 |
| Connector Tickets 236, 240–242 (Hevy, iCloud, Outlook) | Locally verified and independently approved | Live providers, installed desktop and release (241); live Hevy Pro (236); iCloud live acceptance (240); 242 cross-tenant and installed desktop not exercised | TICKETS, Tickets 236, 240, 241, 242 |
| Tickets 243–244: travel backlog | Filed October 22; backlog | None scheduled | TICKETS, Tickets 243–244 |
| Daily Brief release acceptance (grouped): Tickets 147, 148, 155, 161, 168, 169, 172, 173, 174, 182, 183, 185 | In progress or implemented in source; reconciled October 27: still open | Ticket 174 carries hosted, deployed-web and installed-desktop gates; 182–183 owner-run live checks; 185 awaits owner product decisions | TICKETS, Ticket 174 and each listed ticket |
| Google Calendar Timeline (grouped): Tickets 133–137, 141, 150 | In progress; reconciled October 27: still open | Post-approval web and native consent smoke checks; 137 provider-failure, Workspace and installed fixture cases; 150 live custom-name check | TICKETS, Tickets 137, 141, 150 |
| Earlier travel tickets (grouped): 160, 162–164, 166, 167, 170, 171 | Implemented in source or discovery complete | Release gates sit in Tickets 165 and 174; owner re-acceptance for 166–167 | TICKETS, each listed ticket |
| Desktop release follow-ups (grouped): Tickets 142, 143 | Complete in source; web deployed September 18 | Installed-native release acceptance | TICKETS, Tickets 142–143 |
| Operations (grouped): Tickets 091, 104, 105, 128 | 091 and 105 in progress; 104 and 128 blocked; reconciled October 27 | 104: operator diagnostics or an authorized route test; 105: recheck when web-push `latest` changes; 128: a revised candidate needs a new measured gate | TICKETS, Tickets 091, 104, 105, 128 |

## Recent entries

## Ticket 292: day notes in progress — November 10, 2026

Approved by the owner on November 10. Web day notes are implemented in source: the
`day_notes` table and `save_day_note` function (migration
`20261110120000_day_notes.sql`), the shared `NoteEditor`, the day-note control under
every Timeline date, the core resolver and service with tests, and day notes in web
Full JSON and BehaviorLog exports (one-day `review` records that pass the reference
validator). Local verification on November 10: a clean local stack (project
`habit-tracking-app`, network `cadence-local`, through the reviewed Docker proxy)
applied every migration including `20261110120000`, with every published port on
`127.0.0.1`. `tests/sql/ticket-292-day-notes.sql` passed: owner-only reads, revoked
direct writes, compare-and-set saves, clear keeps the row, future days, and no access
for a second account or `anon`. A catalog read matched the hand-written
`database.types.ts` entries; `gen types --local` was not run because the proxy policy
rejects the `postgres-meta` image. MCP contract 1.1.0 adds `list_day_notes`, `update_day_note` and `day_note` on
`get_timeline` days (migration `20261110130000_day_note_integration_writes.sql`); its
SQL fixture and the local read and write integration suites (39 tests) pass.
Desktop: SQLite migration 0021, the native `readDayNotes`/`saveDayNote` commands and
the desktop Timeline control are implemented; account sync contract 3 adds the
`day_note` kind (hosted migration `20261110140000`), with same-date merges described in
`docs/DESKTOP_DATA_MODEL.md`. All 125 Rust tests, the sync resolver tests and the hosted
account-sync SQL fixtures pass locally. Installed-app acceptance has not run.
Desktop export includes day notes like web. A clean local start replayed all 99
migrations with loopback-only ports, and the day-note, account-sync and write-replay SQL
fixtures passed (November 10).
Open in this ticket: day-note shortcuts, restore/import of day-note reviews, day notes
in MCP `search`/`fetch`, and installed-app acceptance. The desktop native
store and SQL verification need the Rust toolchain and Docker.

Platform impact: web, MCP and desktop (local and sync) implemented in source; marketing not applicable; future mobile deferred. Messaging impact: P-028.

## Agent-architecture run: Tickets 286–291 — November 9, 2026

Owner direction: `docs/DECISIONS.md`, 2026-11-09. Six packages ran as parallel subagents. An
orchestrating agent checked each diff against the repository before merging it. Delivered in
one pull request from branch `agentic-architecture`. Details: `docs/TICKETS.md`, Tickets
286–291.

- **Ticket 286, complete.** `STATUS.md` went from 819,376 bytes to under 40,000. History
  moved unchanged to `docs/status/archive/`; all 10,837 non-blank lines of the old file are
  present. `npm run agents:check` enforces the limit and `npm run status:archive` moves old
  entries.
- **Ticket 287, complete.** Thirteen stale statements in `AGENTS.md` are fixed or removed,
  repeated rules are merged, and the reading order names a bounded `STATUS.md` and the
  `docs/OPERATIONS.md` sections every task reads. No product, security, data or scope rule
  changed meaning.
- **Ticket 288, complete in source.** Each Daily Brief model call reports token usage, and
  each failure carries an internal reason such as `provider_incomplete_max_output_tokens` or
  `validation_word_limit`. Both reach the `daily_brief.model` performance span and workbench
  runs. The OpenAI request body and the `/api/advisor/brief` responses are unchanged; tests
  prove both.
- **Ticket 289, candidate only.** A "consolidated" Daily Brief prompt states each rule once
  for recipes 1.1 and 1.2. Mapping, nine resolved conflicts and five owner ambiguities:
  `docs/qa/daily-brief-prompt-consolidation.md`. Not promoted.
- **Ticket 290, implemented.** Each workbench candidate can choose a model, a reasoning
  effort and a prompt variant; runs record what they used. Production stays on
  `DAILY_BRIEF_MODEL`, low effort and the layered prompt. A test pins the production request
  bodies, instructions and `DAILY_BRIEF_PROMPT_REVISION` (`5588d260d8e145ad`).
- **Ticket 291, implemented.** Three headless-client scenarios test the published skills'
  rule to write nothing before the user confirms. Unit-tested with fakes only.

Verification on the merged branch with Node 24: all 15 checks passed. `agents:check`, `interactions:check`,
`resolvers:check`, `core:check`, `design-system:check`, `public-source:check`,
`public-trust:check`, `public-trust:fixtures`, `lint` (0 errors, 1 existing warning),
`typecheck`, `test` (5,305 passed, 122 skipped; `main` before the run had 5,199 passed and
122 skipped), `build`, `desktop:build`, `marketing:build` and `marketing:check`.

Not verified: no model call was made, so prompt quality, the candidate models and the
effort values are untested against the provider. No local-stack or live run of the Ticket
291 scenarios. The token figures in `docs/COSTS.md` stay assumed. Dagger and Docker are not
installed on this machine, so the npm commands ran directly.

Platform impact: repository guidance, development tooling and web server diagnostics. The
web response contract is unchanged; desktop, marketing and future mobile are not applicable.
Messaging impact: none.

## Ticket 293: test-access preflight for acceptance runs — November 7, 2026

**Written on branch `accounts-test` as Ticket 286; renumbered to Ticket 293 and merged to
`main` on November 10, 2026 during branch consolidation. Awaiting verification. No live
probe has run.**

- Engine installed from `service-connections-bootstrap` (skills commit `5c4baab`, branch
  `claude/test-access-preflight`) as `.agentic/scripts/test-access-preflight.mjs`. The skill
  was deployed to `~/.claude/skills` from the same commit at 2026-11-07 22:06Z.
- `.agentic/test-access.json`: 48 requirements across 12 suites, with the 2026-11-07 owner
  decisions applied. `npm run qa:preflight -- --suite <suite> --dry-run` works for every suite.
- Adapters in `scripts/acceptance/access/`. Google Calendar and Outlook connect, test-Mac sign-in,
  QA Chrome permission grants and travel settings are agent steps without a script yet; the
  preflight reports them as check errors for an agent.
- Platform impact: acceptance tooling only. Web, desktop, marketing and future mobile: not
  applicable. Messaging impact: none.

## Follow-up: keep a leave reminder when the send-time Calendar read fails — November 8, 2026

**On branch `leave-reminder-send-read`. Not pushed.** Before this change, the hosted leave
reminder job read Calendar after the send route to name the event. If an Outlook or iCloud read
failed there, it cancelled that reminder. Fixed: the send and update steps read Calendar once
per visit before their route. A destination or planned previous stop the read left out is
released with no route spent,
and the next visit sends while the leave time is ahead. A plan route that finds the reminder due
keeps it pending at its reminder time. A send-time read that fails outright, as a Google read
does, now releases the claims before any route. The three routes of D15 and the D16 update pause
are unchanged; no migration. Remaining limit: if the route used a different previous stop than
planned and that stop is missing from the read, it still cancels or closes (`docs/NOTIFICATION_SPEC.md`, "Leave reminders"). Tests:
`tests/leave-reminder-job.service.test.ts` (fails on the base code), `tests/leave-reminder-hosted-port.test.ts`.
Platform impact: web hosted job only; desktop plans its own reminders and is unchanged;
marketing and future mobile not applicable. Messaging impact: none.

## Follow-up after the Wave 6 deploy: a Behavior place edit withdraws its leave time — November 7, 2026

**On branch `travel-postdeploy-checks`. Not pushed.** Found after the Wave 6 deploy: once, a
Behavior Where edit on /behaviors left the tab's `cadence:travel-session` copy, so /timeline kept
the old leave time as current and made no route request. Cause: the web Timeline's travel source
key had no Behavior Where, so only the `cadence:travel-changed` event withdrew the kept view, and
that event never reaches another tab. Fixed: each Timeline row now carries its Behavior's Where
kind (Home or A place) beside its place text, and `travelSourceKey`, `travelStopRevisions` and
`travelTomorrowStopKey` use the row's Where when no Behavior list is passed. A place edit in any
tab changes the key, so the kept view withdraws that trip and routes again at the next refresh.
The keys stay the same when nothing changed. The Mac already passed its Behavior list and is
unchanged. Test: `tests/travel-timeline.test.ts` fails on the base code; `tests/travel-navigation.test.ts`
covers the row's Where kind. Platform impact: web, this fix (shared `lib/ui/travel.ts` and core
Timeline rows); desktop uses the same shared code with its Behavior list, so no change; marketing
and future mobile not applicable. Messaging impact: none. Not yet rechecked live.

## Follow-up after Mac 0.1.9: reminders for newly added Calendar events — November 7, 2026

**On branch `travel-postdeploy-checks`. Not pushed.** Found on published 0.1.9: a Calendar event
added shortly before leaving got a leave line but no Mac leave reminder until the Mac's Calendar
list refreshed, because the hosted route reads Calendar itself. Fixed: a routed trip ahead whose
stop the Mac does not list makes the Mac read its Calendar lists again once, and the travel hook
keeps the routed view current when the new stop is one it already routed, so no route request is
added. After Codex review on PR #198, that holds only when the response routed the new stop at its
current start, end and place; an event moved in between gets a new request. Evidence in `docs/qa/travel-release.md`, "Calendar-event activation on published 0.1.9".
Platform impact: desktop (Calendar re-read and reminder planning); web shares the hook rule, which
only skips a repeat whole-day request; marketing and future mobile not applicable. Messaging
impact: none. Not yet rechecked on an installed Mac.

## Cadence for Mac 0.1.9 published — November 7, 2026

**Published November 7, 2026, 23:24–23:30Z** (D24–D26). Built from `7c698ec` (PR #196 merge) with
the blank-window fix and the travel advisory revamp. Both feeds serve 0.1.9;
`Cadence_aarch64.dmg` is the 0.1.9 DMG (`93257f4f…`). Packet:
`docs/qa/2026-11-07-desktop-0.1.9-release-packet.md`.

- Notarization: app `b6040799…` and DMG `de9aac5c…`, both Accepted and stapled; 14 artifact checks
  in `build` and in standalone `verify`.
- Test Mac, account A, from the quarantined DMG over 0.1.8: Gatekeeper first open (owner chose
  Open); no table lost rows; the archive notice and its link render where 0.1.8 was blank;
  sign-in and Calendar callback replay, reminder coverage to the 30-day target, session renewal,
  revoked session and Reconnect pass.
- Check 4 (real updater) passed on the owner's Mac: published 0.1.8's own updater installed 0.1.9
  after the stable feed moved, and **Restart Cadence** opened it with no lost rows. The test Mac
  could not run it because 0.1.8 opens blank for account A (D25, D26).
- 0.1.8 users with an auto-archived Behavior cannot reach the updater; the release body tells
  them to download 0.1.9.
- Not established at publication: Calendar-event drawer activation from a leave reminder (Ticket
  285). It passed later that evening on published 0.1.9 (`docs/qa/travel-release.md`,
  "Calendar-event activation on published 0.1.9"). macOS 14 not tested.
- Both Macs now run 0.1.9. The test Mac's 0.1.8 copies and the owner's 0.1.10-dev.1 app are kept
  in their backup folders.
- Platform impact: desktop release only. Web, marketing and future mobile: no change.
  Messaging impact: none.

## Ticket 285: installed Mac acceptance run — November 6–7, 2026

**On branch `travel-wave6`. Evidence in `docs/qa/travel-release.md`, "Ticket 285". No notarization
or publication.**

- Builds: dev-signed `0.1.9-dev.1` (`acc86c4`, owner's Mac and test Mac), `0.1.9-dev.3`
  (`caebbd7`, the blank-window fix) and `0.1.10-dev.1` (`5f629e4`, test Mac, the final checks).
  A throwaway diagnostic build `0.1.9-dev.2` found the defect; it was never committed.
- Found and fixed during the run: the Mac app went blank for an account with an auto-archived
  Behavior (`caebbd7`; released 0.1.8 is affected), and a named place without a street address
  could not route (`d1db8c2`, hosted; needs a deployment before it can be checked).
- Pass on the installed app with test account A: travel states; the next-trip marker (owner
  screenshot); the native leave reminder with Cadence running and with Cadence quit; the one update
  when the leave time moved 15 minutes earlier; activation from a quit app into the Behavior's
  Occurrence; notification permission denied; Travel estimates off cancelling pending and delivered
  leave reminders; sync of published 0.1.8 against production; the installed-Mac row of Ticket 165's
  directions matrix. Owner's Mac: install and launch sync with no row loss.
- Not run: activation into a Calendar event's drawer (the reminder fired while the test Mac was
  locked; synthetic banner clicks do not reach Cadence) and the named-place fix (not deployed).
- Cleanup: account A's leave reminders off, test Behaviors archived, habits restored, Cadence's
  location access restored. The test Mac is back on published 0.1.8 with Cadence quit (it opens
  blank for account A until the fix ships). The owner's Mac still runs `0.1.9-dev.1`.
- `docs/TEST_DEVICES.md` gains the optional Screen Recording grant and the known limits over SSH.
- Platform impact: desktop acceptance only. Web, marketing and future mobile: not applicable.
  Messaging impact: none.

## Ticket 285 defect fixed: a named place without a street address — November 7, 2026

**On branch `travel-wave6`. Awaiting verification and a hosted refresh for Ticket 285.**

- Cause: the place lookup, not the place record or the departure model. Account A's
  "Bryant Park, New York, NY 10018" is stored in `travel_place_cache` as `ambiguous` (read-only
  hosted query, 03:17Z), while the street-address fixtures are `resolved`. The geocode filter
  accepted only `ROOFTOP` or `RANGE_INTERPOLATED` results, so a park found by its center had no
  endpoint, and the departure model correctly read that as `needs_place` ("Add a place for …")
  and the next trip as blocked ("Fix …'s place").
- Fix: `lib/services/travel-provider.ts` also accepts a single `GEOMETRIC_CENTER` or
  `APPROXIMATE` result typed `establishment` or `point_of_interest`, with no coarse type and no
  partial match. Multiple results, coarse areas and unnamed centers stay ambiguous.
- Core `travelPlaceLookupReusable` looks up again any unresolved or ambiguous row stored before
  `TRAVEL_PLACE_NAMED_PLACE_RULE_AT` (2026-11-07T11:00Z), once per stored text. Otherwise such
  rows would be reused for 30 days. No new kind of provider call; no schema change.
- Not verified live: Google's granularity for Bryant Park, because that needs a paid lookup. The
  rule accepts both center granularities, so either routes.
- Tests: `tests/travel-provider.test.ts` (hosted and API key paths) and
  `tests/travel-refresh-policy.test.ts`; the three new tests fail on the base code.
- Checked live after deploy (production `7c698ec`, November 7, 20:49–20:54Z, account A):
  "Bryant Park, New York, NY 10018" gets a leave time, the trip after it routes with no
  "Fix …'s place", its cache row is `resolved`, and "10018" alone stays `ambiguous` and still asks
  for a place (`docs/qa/travel-release.md`, "Named place after deploy").
- Platform impact: web, this fix (hosted lookup). Desktop: linked Macs use the same hosted
  refresh, so no desktop change; Ticket 285 checks it. Marketing: none. Future mobile: not
  applicable. Messaging impact: none (no wording change).

## Ticket 285 defect fixed: blank Mac window from the archive notice — November 7, 2026

**On branch `travel-wave6` (`caebbd7`, `4407477`, verified) and on `main` through PR #195
(cherry-picks `91ef553`, `52e81e0`), which also set the desktop version to 0.1.9. Mac 0.1.9
ships from `main` with the travel revamp once Wave 6 merges (D23). Notarization and publication
follow D24.**

- Cause: the desktop Timeline renders "Review archived behaviors" as a shared `RuntimeLink`
  whenever it has an automatic-archive notice, and it had no `LinkProvider`. The throw unmounted
  the whole app, because the Mac app had no error boundary, so the window was blank and sync
  never ran. Present since `d95dfaa3` (September 18), so released 0.1.8 is affected.
- Fix: `apps/desktop/src/timeline-screen.tsx` provides a link that switches desktop screens and
  never loads the href; `product.tsx` passes its `navigate`. The link opens Behaviors.
- A new `DesktopErrorBoundary` wraps the active screen in `product.tsx` (reset by opening another
  screen or **Try again**), so navigation, account sync and Settings stay mounted. A second one
  wraps `Product` in `main.tsx` and shows the existing "Cadence could not open" message.
- Audit of context-requiring UI on desktop screens: the archive notice was the only
  `RuntimeLink` outside a `LinkProvider`. `BehaviorList`'s links render inside
  `BehaviorsScreen`'s provider and all point to `/behaviors`. `useRefresh` users
  (`DayProgressTimeline`, `StatusButtons`, `OccurrenceNoteForm`) render only inside the Timeline
  and Behaviors `RefreshProvider`s. `PlaceLabels` and the development-build context have safe
  defaults. Settings, Export, onboarding, update and account panels use no required context.
- Wording: the owner approved both recovery messages on November 7, 2026 (D21): "This screen
  could not be shown. Try again, or open another screen." and "Cadence could not open. Quit and
  reopen the app to try again." Logged as `P-027`; the user guide line is still to add.
- Version: 0.1.9, the next patch after the published 0.1.8. By SemVer it is above the
  `0.1.9-dev.1`–`0.1.9-dev.3` builds from `travel-wave6`, so the stable feed updates them. Later
  dev builds use `0.1.10-dev.N`. Release check 4 (real updater) runs at publication step 3,
  updating the test Mac from 0.1.8 to 0.1.9 (owner, November 7: follow the release doc; D24). No
  SQLite migration changed since 0.1.8, so check 3 uses `--same-schema`.
- Tests: `tests/desktop-render-recovery.dom.test.tsx` mounts `Product` with an archived
  Behavior's notice, opens Behaviors from the link, and recovers from a failed screen through
  Settings. `tests/desktop-main-recovery.dom.test.tsx` checks the app-level message. Each fix has
  a test that fails when it is reverted (verifier, Ticket 285).
- Platform impact: web, not applicable (the web Timeline has its `LinkProvider` in
  `WebRuntimeProvider`). Desktop: this fix and Mac 0.1.9; Ticket 285 checked it on the
  installed app. Marketing: none until publication. Future mobile: not applicable, desktop only.
  Messaging impact: `P-027`.

## Travel advisory revamp Wave 6: Ticket 284 findings fixed — November 6, 2026

**On branch `travel-wave6`. Awaiting verification.** Each finding has a test that fails without
its fix. No new wording, no schema change and no provider call.

- Late compares at the displayed minute: an arrival seconds past a 2:15 target is not late (core
  `travelArrivalAfterTarget`, used by the travel and weather-margin resolvers).
- A route checked at or after its leave time reads "Leave now" while it arrives less than 5
  minutes after its target, as it did before the check (departure model). Leave now still ends 5
  minutes after the ideal leave time, so the fresh "If you haven't left for … yet" form follows
  (verifier fix). The fresh "If you
  haven't left yet, you'd be home about" form stays unreachable by design: an estimate lives 5
  minutes, the same as leave now, and a refresh after the event's end no longer plans the trip home.
- Directions stays once an event is under way: the trip leaving the stop counts as its resolved place.
- The screen-reader status speaks a new leave time, the leave time arriving and a new late basis.
- A Behavior's time range wraps after its dash instead of running into its title at 1280 px.
- The web setup panel reads this device's notification state again when the tab returns.
- Tomorrow's first stop shows the line's leave time and Directions in its own drawer, dialog and row.

## Travel advisory revamp Wave 6: Ticket 284 web acceptance with the real clock — November 6, 2026

**On branch `travel-wave6`. Evidence only; no app change. Awaiting verification.**

- Production run on deployment `cadence-pubbpi517` (`9064f5f`) with test account A in the Cadence QA
  Chrome profile, 12:20 PM to 6:30 PM Eastern. Evidence: `docs/qa/travel-release.md`, "Ticket 284".
- The leave reminder job's OIDC subject was present on its first run. That run failed on a stale
  PostgREST schema cache (PGRST205); after the coordinator's reload every run returned 200.
- States seen on the real clock: upcoming, soon, late before and after the leave time, last estimate
  (leave by, leave now, past the leave time), head home soon and now, last estimate home, and
  tomorrow's first trip. Not reached: "Leave time appears later" (the first open routes every trip)
  and the fresh "Leave now" form (a refresh at the leave time re-plans from now and comes out late).
- A real web leave reminder reached the test account by push at 4:05 PM ("Leave by 4:29 PM for W6
  Met visit", "Walking, 45 min from Home. Arrive 5:15 PM."). The earlier one was sent but not
  received because of a test-setup gap in QA Chrome, since fixed.
- Ticket 165: the web denied state and the directions matrix (Chrome on Mac real; Safari on Mac,
  iPhone and iPad, Chrome on Windows, Linux and Android by emulation), the transit, driving and
  cycling checks and the negative checks pass. The installed Mac row stays with Ticket 285.
- Decision D5: the owner set the spend cap at US$5 for this test. Measured: 91 route calls and 4
  lookups, US$0.48 reserved (`docs/COSTS.md`).
- Not checked: Ticket 283's Outlook or iCloud routed event; no test connector exists.
- Observations, not blocking: Behavior range time overlapping its title at 1280 px; setup panel
  showing notifications "Not enabled"; late wording with an arrival equal to the target after
  rounding; a stale screen-reader status after late before → after; E1's link reverting to Search
  once the event started. Each has its text in the evidence.
- Owner decision the same day ("Agents act as the test accounts, end to end", commit `513c5d3`):
  Google sign-in for test accounts from the vault (`scripts/acceptance/google-signin.mjs`). A
  separate workspace finishes the QA Calendar API client (project `cadence-qa-498717`).
- Leave reminders are off again for account A; travel stays on for Ticket 285.
- Platform impact: web, production acceptance only. Desktop: Ticket 285. Marketing: none. Future
  mobile: 390 px checks passed on mobile web. Messaging impact: none.

## Travel advisory revamp Wave 5: wording approved (D20) — November 6, 2026

**On branch `us-work`. Not merged or deployed.**

- Decision D20: the owner approved both Wave 5 phrases. Ticket 282's `line-tomorrow` stays as
  written. Ticket 281's correction note now reads "Applies to every event, Behavior and Home
  with the same location. Turning off Travel estimates forgets it." The bench wording review
  shows all 96 phrases approved, none awaiting. Recorded in `docs/DECISIONS.md`.
- Messaging impact: P-025 and P-021 notes.

## Travel advisory revamp: signed Daily Brief travel lines for all Calendars (D18) — November 6, 2026

**On branch `us-work`. Not merged or deployed. No migration.**

- Ticket 283 follow-up, decision D18: the travel route now signs a one-day plan whose stops
  come from Google, Outlook or iCloud. Outlook and iCloud events are named by source, as the
  brief names them, and the source key binds the Outlook and iCloud connections that took part.
- The Daily Brief accepts the conclusions only when each named event is in its context with the
  same revision. Outlook and iCloud are in that context only under their own disclosure. The
  token carries one flag per Outlook and iCloud Calendar saying whether it had a stop. A stop
  from an undisclosed Calendar withholds the conclusions; an undisclosed Calendar with only
  unlocated, past or declined events is left out of the check, so the other Calendars' lines
  stay (D18 follow-up). A left-out Calendar still withholds them.
- The brief pipeline projects travel beside the Google-only view, so a trip to a disclosed
  Outlook or iCloud event stays visible to the model. Before this change such a context failed
  validation. Model input is unchanged: no leave time, duration or place.
- Messaging impact: note on P-026; no disclosure text changes. Tests:
  `tests/briefing-account-context.test.ts`, `tests/briefing-travel.test.ts`,
  `tests/travel-route-refresh.service.test.ts`, `tests/travel-conclusions-token.test.ts`.
