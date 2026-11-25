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

## Google Workspace Calendar MCP migration, AI Tools Addendum compliance, and conversational travel organizing — November 25, 2026

- **Owner's decisions (Q1–Q8, `docs/DECISIONS.md`, 2026-11-25; `docs/plans/2026-11-25-google-workspace-mcp-migration.md`):**
  migrate all AI Google Calendar reads to `calendarmcp.googleapis.com` (`cadence-calendar-agent-prod`),
  close all 4 REST-to-AI leak paths + latent `day_loads` + workbench §2(f), rebuild AI Google-event
  travel fit from authorized MCP events with provenance-safe MCP/Routes caching, add hybrid `L-001`
  7-day Chat travel organizing (inline exact travel cards, confirmed cross-day moves and recurring
  remodeling, two-layer longitudinal patterns), cap persisted Google `daily_calendar_load` at ≤30d
  with ephemeral >30d Chat MCP lookbacks and an opted-in activity-gated weekly/monthly longitudinal
  review, enable Google Cloud Model Armor (`INSPECT_AND_BLOCK`, Cloud Logging OFF) while keeping T12
  immediate single-record Chat writes with Undo, keep one canonical `Connected sources → Google Calendar`
  dual-grant home with lightweight collapsed pills AI picker and inline `AI features` shortcut, bundle
  versioned `purpose=ai_mcp` desktop support into Cadence for Mac `0.1.16`, and stay on Standard Tier
  ($0, 40 req/user/day cap, 3,500 req/day alert, graceful degradation).
- **Implemented (Phases 1A–4 in source on `feat/google-calendar-mcp-migration`):**
  - Tolerant readers, transport gate & §2(f) guards: `lib/db/daily-brief.repo.ts`,
    `packages/core/src/services/daily-brief-sources.ts`, `lib/services/google-calendar-ai-transport.ts`,
    `lib/services/day-load.service.ts`, `lib/services/briefing-workbench.service.ts`,
    `lib/services/briefing-history.service.ts`, `lib/services/briefing-sequence.service.ts` (and
    deleted the two stale Oct 16 & Oct 23 `.local/briefing-bench/` live captures).
  - Database & maintenance: `supabase/migrations/20261125120000_reactivate_agent_calendar_mcp.sql`
    (5 `calendar_agent_*` RPCs, Ticket 335 identity-lock parity, provenance columns, Nov 19 Chat
    backfill, atomic §2(d) disconnect purge, ≤30d summary/rollup/review expiry, `longitudinal_calendar_reviews`),
    deleted retired `app/api/google-calendar/agent-grants/retire/route.ts`, updated
    `lib/services/sign-in-methods.service.ts`, `lib/services/agent-run-maintenance.service.ts`, and
    `tests/sql/google-calendar-agent-mcp-contract.sql`.
  - MCP adapter, caching, Model Armor & leak closure: `lib/services/google-calendar-mcp-provider.ts`,
    `lib/services/google-calendar-mcp-cache.ts`, `lib/services/model-armor.service.ts`,
    `lib/services/google-calendar.service.ts`, `lib/services/daily-calendar-load.service.ts`,
    `lib/services/travel-conclusions-token.ts` (`v2`), `lib/services/travel-route-refresh.service.ts`,
    `lib/services/briefing-account-context.service.ts`, `lib/services/daily-brief.service.ts`,
    `lib/services/brief-moves.service.ts`, `lib/services/brief-opportunities.service.ts`.
  - Core resolvers & Chat: `packages/core/src/types/chat-travel.ts`,
    `packages/core/src/resolvers/travel-horizon.resolver.ts`,
    `packages/core/src/resolvers/longitudinal-patterns.resolver.ts`, `lib/db/chat.repo.ts`,
    `lib/services/chat/{chat-tools,chat-executor,chat-turn,chat-writes,chat-prompt,chat.service,chat-settings}.ts`,
    `components/chat/ChatMessages.tsx` (`travel_card`), `lib/services/longitudinal-calendar-review.service.ts`.
  - Settings & Mac `0.1.16` broker: `app/api/google-calendar/{connection,calendars}/route.ts`,
    `components/settings/GoogleCalendarPanel.tsx`, `components/briefing/DailyBriefSettingsPanel.tsx`,
    `lib/ui/google-calendar.ts`, `lib/ui/settings-sections.ts`,
    `apps/desktop/src/calendar/{google-calendar,use-google-calendar}.ts`, `apps/desktop/src/product.tsx`.
- **Next actions (Phases 0, 5 & 6):** run Phase 0 live `calendarmcp.googleapis.com` wire check once a
  fresh Google sign-in token is available, run local Supabase rehearsal (`db reset` + SQL fixtures),
  deploy tester verification environment and submit Ticket 245 data-access verification for
  `cadence-calendar-agent-prod` by mid-December 2026, and bundle into Cadence for Mac `0.1.16`.

Platform impact: web implemented (Phases 1A–4 in source); desktop implemented (versioned `purpose=ai_mcp`
broker and shared Settings UI bundled for Mac `0.1.16`); marketing follow-up in Ticket 246; future mobile
deferred. Messaging impact: `P-090`. Legal: `L-001`, `L-021`, `L-026`, `L-027`.

## Tickets 352–355: Persisted connector activity (`recorded_activities`, `daily_calendar_load`) and bounded past calendar drill-down — November 24, 2026

- **Owner's decision:** keep persisted connector activity until disconnect or account deletion;
  persist minimized Hevy workout timing in hosted-only `recorded_activities` with bounded connect
  backfill, incremental `/v1/workouts/events` sync on its own `ledger_cursor` (separate from
  completion's `read_cursor`), daily background polling for unlinked accounts (prioritized behind
  linked completion accounts, paused after 21 days of Cadence inactivity and re-armed on next
  open), 15-minute on-demand freshness, and non-PII `reportMonitoringEvent` telemetry; persist
  derived daily calendar busy-load rollups (`daily_calendar_load`, no event details) via
  write-through on complete reads + 30-day backfill on selection and hard-delete on
  disconnect/selection change; expose `list_calendar_load` and widen Chat `list_calendar_events`
  to bounded past dates (≤31 days per call) with timezone-aware date coalescing and ephemeral
  session caching (`docs/DECISIONS.md`, 2026-11-24).
- **Implemented:**
  - Migrations: `supabase/migrations/20261124193000_recorded_activities_ledger.sql`,
    `20261124193500_unlinked_hevy_background_sync.sql`,
    `20261124194000_daily_calendar_load.sql`, and
    `20261124195000_recorded_activity_ledger_cursor.sql`; updated `lib/db/database.types.ts`.
  - Core resolvers: `packages/core/src/resolvers/calendar-load.resolver.ts` (re-exported in
    `lib/resolvers/calendar-load.resolver.ts`, registered in `docs/AGENT_RESOLVERS.md` and
    `scripts/check-resolvers.mjs`); `resolveUnlinkedDailySyncSchedule` / `isUnlinkedAccountInactive`
    in `packages/core/src/resolvers/completion-check-schedule.resolver.ts`.
  - Repos & services: `lib/db/recordedActivities.repo.ts`, `lib/db/dailyCalendarLoad.repo.ts`,
    `lib/services/recorded-activity-sync.service.ts`, `lib/services/daily-calendar-load.service.ts`,
    `lib/services/hevy-provider.ts`, `lib/services/hevy.service.ts`,
    `lib/services/connector-completion.service.ts`, `lib/services/connector-completion-job.service.ts`,
    `lib/services/google-calendar.service.ts`, `lib/services/outlook-calendar.service.ts`,
    `lib/services/icloud-calendar.service.ts`.
  - Consumers & Chat: `app/api/hevy/activities/route.ts`, `lib/services/advisor-day-context.service.ts`,
    `lib/services/chat/chat-calendar-cache.ts`, `lib/services/chat/chat-tools.ts`,
    `lib/services/chat/chat-executor.ts`, `lib/services/chat/chat.service.ts`,
    `lib/services/chat/chat-prompt.ts`, `lib/services/chat-eval/fake-tools.ts`.
  - Tests: `tests/calendar-load.resolver.test.ts`, `tests/daily-calendar-load.service.test.ts`,
    `tests/recorded-activity-sync.service.test.ts`, `tests/chat-past-calendar-drilldown.test.ts`.
- **Verification (Node 24):** `agents:check`, `interactions:check`, `map:check`, `resolvers:check`,
  `core:check`, `lint` (0 errors), `typecheck`, `build`, `dagger check --cadence`, and full
  `npm run test` all pass.

Platform impact: web implemented; desktop unaffected (hosted-only tables, no SQLite or `account_sync`
changes; linked Macs inherit hosted Brief/Chat/Timeline reads); marketing not applicable; future mobile
deferred. Messaging impact: `P-087`, `P-088`, `P-089`. Legal: `L-023` updated, `L-026` logged.

## Advisor speech pill on banner, larger avatar, and removal of AdvisorDayLine — November 24, 2026

- **Owner's decision:** remove `AdvisorDayLine` under today's date to reduce Timeline header
  density; replace `"Advisor · 1 new"` with a rounded speech pill showing a concise teaser
  (`advisorBubbleTeaser`) when something waits (hiding the `"Advisor"` label while the pill is
  shown); increase the Timeline avatar to 72px on desktop/Mac (side-by-side speech pill, enables
  full mane-ripple detail) and 60px on phones (moved out of the top nav bar onto the wave banner,
  speech pill stacked below); let the advisor header scroll naturally with the page
  (`docs/DECISIONS.md`, 2026-11-24).
- **Implemented:** `components/advisor/AdvisorParts.tsx`, `components/advisor/advisor-window.module.css`,
  `components/advisor/AdvisorTimelineFrame.tsx`, `components/advisor/AdvisorAvatar.tsx`,
  `lib/ui/advisor.ts`, `components/timeline/DayProgressTimeline.tsx`,
  `packages/core/src/advisor-avatar/catalog.json`, `public/brand/advisor/advisor-{60,72}-{1,2,3}x.webp`,
  `apps/desktop/vite.config.ts`, `DESIGN.md`, `tests/advisor-ui.dom.test.tsx`, and
  `tests/advisor-avatar.dom.test.tsx`.

Platform impact: web implemented; desktop implemented (shares components and bundles the 60px/72px
avatar renditions in `apps/desktop/vite.config.ts`, ships in next Mac release); marketing not
applicable; future mobile deferred. Messaging impact: P-086.
