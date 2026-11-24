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

## Remove Recorded activity · Hevy section from Timeline header — November 24, 2026

- **Owner's decision:** remove the dedicated `"Recorded activity · Hevy"` section (including
  `"No recorded workouts today."`) from the Timeline header while preserving internal Hevy
  reads, connector completion (`occurrence_source_matches`), Daily Brief/Chat context, and
  `countableWorkouts` on occurrences (`docs/DECISIONS.md`, 2026-11-24).
- **Implemented:** removed `<RecordedActivityList>` from `components/timeline/DayProgressTimeline.tsx`,
  deleted `components/timeline/RecordedActivityList.tsx` and its unused `.activity` CSS rules in
  `components/timeline/day-progress-timeline.module.css`, updated the design-system bench and
  manifests (`app/design-system/ConnectorBench.tsx`, `app/design-system/page.tsx`,
  `design-system.{manifest,surfaces,usage}.json`), regenerated `docs/PRODUCT_MAP.md`, and updated
  `tests/day-progress-timeline.dom.test.tsx`, `tests/connector-library.dom.test.tsx`, and
  `tests/recorded-activity-refresh.test.ts`.

Platform impact: web implemented; desktop implemented (shares `DayProgressTimeline`, ships in
next Mac release); marketing not applicable; future mobile deferred. Messaging impact: P-085.

## Note shortcuts revamp: inline chips, full history, floor of 2, and AI pattern analysis — November 24, 2026

- **Owner's decision:** remove the Day note shortcuts drawer from Settings → General and the
  static Note shortcuts section from Behavior Details & Settings; show shortcuts inline in
  `NoteEditor` by default (ranked by frequency + recency, capped at 5) with inline dismiss (`×`);
  drop the 90-day cutoff (full history up to today), lower the minimum floor from 3 to 2, normalize
  trailing punctuation and multi-line notes; and layer AI pattern analysis (`openai/gpt-5.6-luna`)
  gated on `Settings → AI features → Notes` (`docs/DECISIONS.md`, 2026-11-24).
- **Implemented:**
  - Step 1: `supabase/migrations/20261124103000_note_shortcuts_min_two_evidence.sql` and Rust
    validator `apps/desktop/src-tauri/src/local_store/db.rs` (min 2 evidence);
    `packages/core/src/resolvers/note-suggestion.resolver.ts` (full history, floor 2, trailing
    punctuation normalization, multi-line matching, `rankInlineNoteShortcuts`);
    `packages/core/src/services/note-shortcut.service.ts` (`listInlineNoteShortcuts`,
    `dismissNoteShortcut`); `components/notes/NoteEditor.tsx` (`NoteShortcutDismissProvider`,
    inline proposed+accepted chips with inline `×` dismiss); removed Day note shortcuts drawer from
    `app/(app)/settings/page.tsx`, `apps/desktop/src/settings-screen.tsx`, and
    `apps/desktop/src/product.tsx`, and removed `<NoteShortcutSettings>` from
    `components/behaviors/BehaviorList.tsx`.
  - Step 2: `mergeModelNoteSuggestions` in `packages/core/src/resolvers/note-suggestion.resolver.ts`,
    `note_shortcuts` model config in `lib/services/agent-model.ts`,
    `lib/services/note-shortcut-ai.service.ts` (gated on `ai.approved && sources.notes`, 12h
    cooldown, max 40 notes / 500 output tokens), wired into `matchRepeatedNotesAfterNoteSave`, and
    `docs/COSTS.md` updated.
- **Hosted migration applied:** `20261124103000_note_shortcuts_min_two_evidence.sql` pushed to
  hosted Supabase on November 24, 2026 (Local and Remote histories match).
- **Pending:** merge to `main` (web deploy) and publish Cadence for Mac `0.1.16` (older linked
  Macs still require ≥ 3 evidence on proposed entries until they update).

Platform impact: web implemented (hosted migration applied); desktop implemented (ships in
Cadence for Mac `0.1.16`); marketing not applicable; future mobile inherits the same core
resolver. Messaging impact: none.

## Cadence for Mac 0.1.15 published — November 23, 2026

- **Published November 24, 04:49Z (Nov 23, 23:49 EST)** on the owner's instruction. Version
  bump PR #370 (`6e468d72`); notarized (`6cd35997-0ad9-4d69-8288-656776dc5a0f`, DMG
  `67f0672d…`), 14 artifact checks, quarantined download checks, and public readback all
  passed. Batched Sub-behaviors / SQLite schema 28 / contract 9 (PR #354), Advisor avatar
  updates (PRs #357, #360, #361, #364), Ticket 341 (PR #359), Ticket 351 auto-stop timer
  on Completed (PR #368, hosted migration `20261123183000` live), PR #369 duration context
  + `InlineDurationControl`, and Trust/tooling fixes.
- **Test Mac (`test-mac`):** `0.1.14` updated through the real updater (**Check for updates**
  → **Install update** → **Restart Cadence**); schema 27 → 28, integrity `ok`, 0 FK errors,
  profile kept, 73 Behaviors / 257 Occurrences preserved, launch sync succeeded at
  `04:48:30Z` with 0 pending (`acceptance-20261124T044832Z.json`).
- **Release packet:** `docs/qa/2026-11-23-desktop-0.1.15-release-packet.md`.

Platform impact: desktop published (`desktop-stable` and `desktop-preview` feeds, version-free
`Cadence_aarch64.dmg`); web already live on `main`; marketing download link points at
`Cadence_aarch64.dmg` (no site rebuild needed); future mobile deferred. Messaging impact: none.

## Ticket 351: Auto-stop running time-tracking session on Completed — November 23, 2026

- **Owner's decision:** transitioning an Occurrence to `completed` (not `not_completed`)
  atomically stops any running `occurrence_time_sessions` row on that Occurrence at
  `greatest(started_at, status_marked_at)`; existing completed rows are not backfilled
  (`docs/DECISIONS.md`, 2026-11-23).
- **Implemented:** `resolveStopTimeTrackingOnStatusTransition` in
  `packages/core/src/resolvers/time-tracking.resolver.ts`; Postgres migration
  `supabase/migrations/20261123183000_auto_stop_time_session_on_completed.sql` updating
  `apply_occurrence_status_transition` (covering single marks, routine bulk marks, and
  MCP); desktop SQLite `apps/desktop/src-tauri/src/local_store/occurrence.rs`;
  `components/timeline/TimeTracker.tsx` server-tracking key sync; unit, DOM, migration,
  Rust, and rollback SQL smoke tests (`tests/sql/ticket-351-auto-stop-time-session-on-completed.sql`).
- **Pending:** hosted migration push and next Cadence for Mac release.

Platform impact: web implemented (awaits hosted migration push); desktop implemented
(ships in next Mac release); marketing not applicable; future mobile deferred. Messaging
impact: none.

## Advisor avatar: step 2 review 1, breathing softens the drawing — November 22, 2026

- **In review (draft PR, branch `claude/avatar-motion-review`).** The owner returned to the
  animation step. Measured in the bench: the whole-drawing breathing leaves the avatar at
  56 to 69% of the still drawing's sharpness; without it, 78 to 94%.
- **Bench:** `/design-system?preview=advisor-avatar`, "Breathing options", rows A (as
  shipped), B (no breathing), C (panel only), and "Head and neck movement", four trials.
- **Product changes in the same PR:** the circle is the page background, not light blue
  (owner's request); the rig gains a head layer that nothing moves yet; the mane is
  painted last, which keeps the face sharp while the mane sways.
- **Waits for the owner's choice.** Findings: `docs/plans/2026-11-21-advisor-avatar.md`,
  "Step 2 review".

Platform impact: web and desktop share the changed component (desktop in its next
release); marketing not applicable; future mobile deferred. Messaging impact: none.

## Ticket 350 started: organization transfer and merge queue — November 22, 2026

- **Owner's decision:** move `emixd12/cadence` to a free organization named `cadence-me`
  so `main` can use a merge queue (`docs/DECISIONS.md`, 2026-11-21).
- **Prepared:** `CI` runs on `merge_group` (PR #356). The Trust history downloader accepts
  `https://emixd12.github.io/cadence/trust/` and the older root when the Pages root is
  `https://cadence-me.github.io/cadence/`. The `emixd12.github.io` archive holds a staged,
  byte-exact copy of 112 evidence files (commit `e33d350`).
- **Not started:** the transfer, the URL changes and the queue setting. The organization
  did not exist on November 22.
- **Verification:** `tests/public-trust-publication.test.ts`, 51 passed;
  `dagger check --cadence --progress=report`.

## Advisor avatar: exact-size files (Ticket 343, round 5) — November 22, 2026

- **Owner's choice:** option B of round 5, "Go with B". Same drawing, tone strengths and
  crop; one file per product size (40, 48, 120) and screen density (1×, 2×, 3×).
- **Shipped on web:** nine files under `public/brand/advisor/` from `npm run avatar:build`
  (lossless WebP); the catalog's `art.renditions` with each file's `area` and `pixels`;
  `AdvisorAvatar` picks the file from the screen's density. `advisor-256.webp` removed.
- **Measured** in the bench in Chrome at 1×, 2× and 3×: crisper with the still drawing.
  With motion on, the breathing movement softens the drawing before and after alike.
  That is step 2's to settle.
- **Not done:** installed Mac not checked (next Mac release); the circle's colour is
  unchanged.

Platform impact: web implemented; desktop shares the component and lists the new files in
`apps/desktop/vite.config.ts`, next release; marketing not applicable; future mobile
deferred. Messaging impact: none.

## Advisor avatar: Ticket 343 round 4, master confirmed — November 22, 2026

- **Reopened by the owner, then confirmed.** Round 3 was approved in a hurry, so the
  owner compared the shipped master with the Sunburst render and round 2's pick and kept
  the master ("go with A"). Unanswered: the 40px and 48px files, the 120px file, the crop.
- **Round 4** reviews that master and adds no candidate. Sheet:
  `docs/design-exploration/advisor-avatar/round-4-baseline-review.png`. Findings and the
  open answers: `docs/plans/2026-11-21-advisor-avatar.md`, "Round 4".
- **Docs only.** No product file changed; no checks beyond `agents:check` apply.

Platform impact: none (web, desktop, marketing and future mobile unchanged). Messaging
impact: none.

## Advisor avatar: approved master and motion on web (Tickets 343–346) — November 22, 2026

- **In review (PR #357, branch `claude/eloquent-turing-ua4q6s`), merging on green.** The
  owner approved the three-tone vector trace as the master and asked for the animations
  and a quick production deployment.
- **Shipped:** `assets/advisor-avatar/master.svg`; `npm run avatar:build` and the two
  files under `public/brand/advisor/`; anchors in the catalog; the resolver
  (`advisor-avatar.resolver.ts`); `AdvisorAvatar` with 7 states and 4 gestures on the
  Timeline, the panel and the Chat page; bench `/design-system?preview=advisor-avatar`.
- **No flag** (DECISIONS, 2026-11-22). Reverting the pull request turns the motion off.
- **Not done:** brief moves do not reach the avatar; installed Mac not checked; the old
  trial bench stays.
- **Verification (Node 24):** `agents:check`, `interactions:check`, `map:check`,
  `resolvers:check`, lint (0 errors), typecheck, build and `avatar:check` pass.
  `npm run test`: 6,844 pass; 1 file fails (`tests/mcp-hosted-fixtures.test.mjs`, shallow
  clone). Bench screenshots of every state, a blink, two gestures, the Timeline, the panel
  and Chat.

Platform impact: web implemented; desktop shares the components and files, next release;
marketing not applicable; future mobile deferred. Messaging impact: none.

## Advisor avatar track scoped (Tickets 343–348) — November 21, 2026

- **In review (draft PR, branch `claude/eloquent-turing-ua4q6s`).** The owner asked for
  the avatar in three steps: base image, animations on it, then scope and tests. Plan:
  `docs/plans/2026-11-21-advisor-avatar.md`.
- **Finding.** The trial's animations target the old side-profile drawing by fixed
  coordinates, so none apply to the placement K drawing. The small avatar's file is the
  same drawing with much heavier lines, which is why it reads as a different horse.
- **Landed.** `packages/core/src/advisor-avatar/catalog.json` (7 states, 4 gestures, all
  planned; the art block); the product map reads it as `avatar:` items and `map:check`
  validates it. No product screen changed.
- **Ticket 343 round 1.** Comparison sheet of four line weights made from the large
  drawing, beside the current small file. Owner: between A and B.
- **Owner answers, same day.** The side-profile drawing is the style reference; image
  model allowed; the preparing arc stays; the advisor appears on Chat; recording interface
  use is deferred (Tickets 347 and 348).
- **Ticket 343 round 2.** Three candidates from `gpt-image-2` (one request), the placement
  K pose in the profile's style, at ink ×1.25 for small sizes. Owner chose candidate 1.
- **Ticket 343 round 3, November 22.** Candidate 1 re-rendered by `gpt-image-2.6-sunburst`
  at quality `max` (2048px), and a three-tone vector trace of it. Awaiting the owner.
- **Verification (Node 24):** `agents:check`, `interactions:check`, `map:check`,
  `resolvers:check`, lint (0 errors), typecheck and build pass. `npm run test`: 6,801
  pass; 1 file fails (`tests/mcp-hosted-fixtures.test.mjs` needs full git history; the
  cloud clone is shallow).

Platform impact: none yet (docs, catalog and map only). Messaging impact: P-081 (planned).

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
