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
| Tickets 301–309: Settings regroup and simplification | Merged to `main` November 11 as PR #205 (`6dd414f8`); all six hosted migrations pushed; Daily Brief grant retired; signed-in hosted check passed November 11 as test account A at 1280 and 390 px; installed Settings check (302) passed in linked and local mode on notarized 0.1.10 | Owner sets the Google Maps spend cap, then an agent runs one hosted Home lookup (308); owner deletes the vault item `google-calendar-agent-retire-secret`; owner reads `docs/qa/2026-11-10-settings-wording.md` | TICKETS, Tickets 301–309; STATUS, "Tickets 301–309 hosted verification — November 11, 2026"; `docs/qa/2026-11-12-desktop-0.1.10-release-packet.md` |
| Tickets 310–324: connector completion (D28) | 310–323 complete; `CADENCE_CONNECTOR_COMPLETION` on in Production since November 13, 2026, 04:30 UTC. Ticket 323 matrix passed on a local stack, deployed web and the installed Mac 0.1.10 (`docs/qa/2026-11-12-connector-completion-acceptance.md`) | Owner deletes the Hevy test workouts and routines, then an agent records the `deleted`-event rows. One-day Vercel usage measurement due after November 14, 04:30 UTC (US$5/month ceiling, `docs/COSTS.md`). Ticket 324 in progress | TICKETS, Tickets 310–324; DECISIONS, 2026-11-12 |
| First account link times out for a large account | Fixed: PR #247 merged as `7e829202` with hosted migration `20261112120000`; the owner's Mac first link passed November 12 at 05:52Z | The Mac error-text fix ships with the next Mac release | STATUS, "Owner's Mac first link after the hosted fix — November 12, 2026" |
| Ticket 326: configuration history in two key shapes (defect D2, web export 500) | Read-side fix on branch `claude/fix-export-camelcase-60ae30`: export, BehaviorLog restore and Daily Brief history normalize camelCase snapshots; the export route logs failures | Merge and check export as account A on production; Mac account sync still uploads camelCase snapshots (writer fix ships with a later Mac release); optional data migration needs the owner's approval | TICKETS, Ticket 326; STATUS, "Ticket 326: web export reads Mac-written configuration history — November 11, 2026" |
| Ticket 293: test-access preflight | Merged November 10, 2026; awaiting verification | First live preflight run per suite | TICKETS, Ticket 293; STATUS, "Ticket 293: test-access preflight for acceptance runs — November 7, 2026" |
| Tickets 294–300: Daily Brief on the user's ChatGPT plan | 294–299 merged; hidden behind `VITE_CADENCE_CHATGPT_PLAN`; 300 deferred | Paused by the owner on November 12: the feature stays hidden and Ticket 300 waits until the owner turns it on. The production device-model flag must stay unset; L-019 logo gap and P-029 to P-031, P-045 and P-046 messaging review remain activation gates | TICKETS, Tickets 294–300; `docs/DECISIONS.md`, 2026-11-12 |
| Tickets 289–290: Daily Brief prompt, model and effort candidates | Candidates in the development workbench; production pinned; comparison on H1–H10 and S1 prepared November 11 | Owner sets a spend cap (US$2 asked) and optionally names extra models; agents run the comparison; the owner promotes or rejects under Ticket 184's rules | TICKETS, Tickets 289–290; `docs/qa/daily-brief-prompt-consolidation.md`, "Prepared owner comparison" |
| Ticket 291: skill-rule acceptance scenarios | Local-stack run with `claude-code` passed all three scenarios November 11 | Production run with the API clients; needs a spend cap for the QA keys | TICKETS, Ticket 291; `docs/qa/mcp-server.md`, "First local run — November 11, 2026" |
| Leave reminder send-time Calendar read (follow-up) | Entry says "not pushed"; `git log` shows PR #200 merged as `2d16bf12` | Deployment not recorded: unclear — see source | STATUS, "Follow-up: keep a leave reminder when the send-time Calendar read fails — November 8, 2026" |
| Behavior place edit withdraws its leave time (web) | Entry says "not pushed"; `git log` shows PR #198 merged as `d643a6e7` | Not yet rechecked live | STATUS, "Follow-up after the Wave 6 deploy: a Behavior place edit withdraws its leave time — November 7, 2026" |
| Mac leave reminders for newly added Calendar events | PR #198 in 0.1.10; installed run on November 12 inconclusive (event too close to plan a reminder) | Rerun on the test Mac with an event at least two hours ahead | STATUS, "Cadence for Mac 0.1.10 notarized — November 12, 2026" |
| Updater key rotation and new Developer ID identity | 0.1.10 published November 12, 05:29–05:33Z, with the rotated key and new identity; 0.1.9 and earlier install it by hand once | Renew the certificate before December 11, 2027. The next release (PR #241 native code, PR #243 UI) needs a new dormant build and ordinary installed acceptance | DECISIONS, 2026-11-11; STATUS, "Cadence for Mac 0.1.10 notarized — November 12, 2026"; release packet, "PR review follow-up" |
| Ticket 325: release credential backup and restore | Identity, notarization-password and updater backups verified November 12; API-key backup and checks recorded as passed in `dd4cb67b`; notarization uses the API key (0.1.10) | Certificate-renewal spike | DECISIONS, 2026-11-11 (D29); TICKETS, Ticket 325; STATUS, "Ticket 325: live backups verified — November 12, 2026"; 0.1.10 release packet |
| Cadence for Mac 0.1.10 | Published November 12, 2026 (0.1.9 on November 7) | macOS 14 not tested; 0.1.9 and earlier install 0.1.10 by hand once (rotated updater key) | `docs/qa/2026-11-12-desktop-0.1.10-release-packet.md`, "Publication" |
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
| Connector Tickets 236, 240–242 (Hevy, iCloud, Outlook) | Hevy, Outlook (personal account) and iCloud (owner's Apple Account) passed on production web and installed Mac 0.1.10 (November 11–12); cross-tenant Outlook checks skipped by owner decision | Not verified on production: an iCloud event on Timeline (no events in the selected calendars), the Outlook `cadence://` completion, sign-out and account-switch cache cleanup, Hevy key entry on the Mac. Owner revokes the "Cadence QA" app-specific password when testing ends. 241 step 7 copy is live and awaits the owner's review | TICKETS, Tickets 236, 240, 241, 242; STATUS, "iCloud production acceptance — November 12, 2026" |
| Tickets 243–244: travel backlog | Filed October 22; backlog | None scheduled | TICKETS, Tickets 243–244 |
| Daily Brief release acceptance (grouped): Tickets 147, 148, 155, 161, 168, 169, 172, 173, 174, 182, 183, 185 | In progress or implemented in source; reconciled October 27: still open | Ticket 174 carries hosted, deployed-web and installed-desktop gates; 182–183 owner-run live checks; 185 awaits owner product decisions | TICKETS, Ticket 174 and each listed ticket |
| Google Calendar Timeline (grouped): Tickets 133–137, 141, 150 | In progress; reconciled October 27: still open | Post-approval web and native consent smoke checks; 137 provider-failure, Workspace and installed fixture cases; 150 live custom-name check | TICKETS, Tickets 137, 141, 150 |
| Earlier travel tickets (grouped): 160, 162–164, 166, 167, 170, 171 | Implemented in source or discovery complete | Release gates sit in Tickets 165 and 174; owner re-acceptance for 166–167 | TICKETS, each listed ticket |
| Desktop release follow-ups (grouped): Tickets 142, 143 | Complete in source; web deployed September 18 | Installed-native release acceptance | TICKETS, Tickets 142–143 |
| Operations (grouped): Tickets 091, 104, 105, 128 | 091 and 105 in progress; 104 and 128 blocked; reconciled October 27 | 104: operator diagnostics or an authorized route test; 105: verify deployed browser-push delivery after the reviewed web-push 4.0.0 upgrade; 128: a revised candidate needs a new measured gate | TICKETS, Tickets 091, 104, 105, 128 |

## Recent entries

## Connector completion turned on in Production — November 13, 2026

- **Flag on.** The owner approved turning `CADENCE_CONNECTOR_COMPLETION` on after the local
  matrix. Production was redeployed (`dpl_GYPJvtPZFmSEwZ6VL1zgUN4Vy9AT`, commit `5ff760f0`)
  at 04:30 UTC.
- **Deployed web passed** as test account A: links saved, the first reconcile completed 12
  Occurrences and attached 2 workouts with 0 refused, and "From Hevy" shows at 1280 and 390 px.
- **Installed Mac passed** (0.1.10, test Mac): a forced collision kept both root events on
  hosted and on the Mac, the manual Not Completed won, and the outbox emptied (Ticket 319).
  The Mac showed "From Hevy" and the workout time (Ticket 320).
- **Defect fixed before turning on:** the Timeline's match read sent 200 IDs in one filter
  and failed with "URI too long", so no label showed (PR #252).
- **Open:** the owner deletes the Hevy test items; the usage measurement after one day.

Platform impact: web and Mac acceptance; no code in this entry. Messaging impact: none
(P-042 was logged by Ticket 310).

## iCloud production acceptance — November 12, 2026

Ticket 240 ran on production as test account A with the owner's own Apple Account (Apple
refused a test account; custody decision 2026-10-19). Evidence:
`docs/qa/2026-11-11-connector-acceptance.md`, "Ticket 240".

- **Passed on web:** connect, 5 calendars listed, selection auto-saves, a complete 30-day
  read, the all-day toggle, disconnect (`apple_app_specific_password`, reads fenced with 409)
  and reconnect. **On the installed Mac 0.1.10:** Settings shows iCloud connected and the
  cache holds a complete iCloud snapshot at the hosted generation.
- **Not verified on production:** iCloud events on Timeline. The selected calendars had no
  events from today through +30 days, and no test events were created in the owner's
  calendars. Wrong-principal reconnect not run.
- **241 step 6:** all three connectors passed their production smoke. Step 7 copy awaits the
  owner's review in the messaging track.
- **Tooling fix:** the preflight's QA Chrome probe missed a profile launched with
  `--user-data-dir` last; the iCloud renewal now reads the vault field `password`, because a
  relabeled built-in password field is read by its id.
- **Owner:** revoke the "Cadence QA" app-specific password at account.apple.com when testing
  ends; A's iCloud connection then needs a reconnect.

Platform impact: test evidence and acceptance tooling only. Messaging impact: none.

## Connector completion: owner decisions and the 0.1.10 ledger — November 12, 2026

- **Mac 0.1.10 is published.** The publication record (commit `1c34c407`) stayed on an
  unmerged branch, so `main` said 0.1.9. The release packet now carries the publication
  section; both public feeds served 0.1.10 when read back on November 12.
- **Owner decisions** for Tickets 319–324 are in `docs/DECISIONS.md`, 2026-11-12, "Finish
  connector completion": iCloud vault item added, no messaging gate, Hevy test writes and
  deletions allowed, one Hevy Pro account, agents revoke Outlook, the flag turns on after the
  323 matrix with a US$5/month usage ceiling, and 324 may merge.

Platform impact: records only. Messaging impact: none.

## Owner's Mac first link after the hosted fix — November 12, 2026

After PR #247 and hosted migration `20261112120000`, an agent quit and reopened Cadence 0.1.10 on
the owner's Mac (still linked, empty local profile), which reran the `hydrate` first link. It
synced at 05:52:12Z: 42 Behaviors, 2,486 Occurrences, 0 pending writes, one account-sync
baseline, integrity `ok`, 0 foreign-key errors. The first-link timeout is closed; the Mac's
error-text change waits for the next Mac release.

Platform impact: desktop verification only; no code change. Messaging impact: none.

## First account link times out for a large account — November 12, 2026

The owner's Mac (published 0.1.10, empty local profile, first link choice `hydrate`) got
HTTP 500 from `apply_account_sync_plan` twice; Postgres logged a statement timeout.

- Cause: hosted `authenticated` has `statement_timeout=8s`. PostgREST applies the called
  function's own timeout; `read_account_sync_snapshot` sets 25 s, but
  `public.apply_account_sync_plan` set none. One snapshot build for the owner's account
  (about 7,000 entities, 5 MB) took 1.8–2.4 s on hosted, and the apply built it two or
  three times.
- Fix: migration `20261112120000_account_sync_apply_large_account.sql` sets 25 s on the
  public apply wrapper, builds the snapshot once before the compare, reuses it for the
  older-contract restore, and reuses it as the result when the plan has no hosted writes.
  Same signature and results. New fixture `tests/sql/account-sync-large-account-apply.sql`
  (2,500 Occurrences, 2,500 reminder deliveries).
- Mac: `localErrorMessage` now shows the `message` of plain-object Supabase errors
  instead of "Unable to save the local change. Try again." Ships with the next Mac release.
- Verification: local stack replay of every migration; all 47 `tests/sql` fixtures passed.
- Open: hosted push, the owner's Mac retry, and its integrity check.

## Installed connector checks on Mac 0.1.10 — November 12, 2026

An agent ran installed connector acceptance on the test Mac (published 0.1.10, account A)
from 05:40 to 05:55Z. Evidence: `docs/qa/2026-11-11-connector-acceptance.md`, "Installed
desktop".

- **Passed:** per-source cache fences; complete Hevy and Outlook snapshots at the hosted
  generation; Settings states match hosted; an Outlook test event refreshed into the cache and
  onto the Mac Timeline; Hevy recorded-activity line; disconnect from the Mac (confirmation,
  hosted generation bump, Outlook cache deleted, Hevy cache kept, revocation text); Connect
  from the Mac opens Microsoft's `common` authorize page with `Calendars.Read`; a reconnect
  from the web reaches the Mac (generation 5).
- **Not run:** Microsoft sign-in completion through `cadence://` (no remote browser driving),
  the Keychain attempt item (not visible to `security` over SSH), sign-out and account-switch
  cleanup (would unlink the Mac), Hevy key entry on the Mac, and iCloud.
- **Test Mac handed back** to mac-release for its leave-reminder recheck: Cadence 0.1.10
  running and linked as A, Outlook and Hevy connected, nothing else changed.
- **Defects:** none found.

Platform impact: desktop evidence only. Messaging impact: none.

## PRs 238–245 integration and release review — November 12, 2026

Reviewed, repaired and merged #242, #238, #240, #241, #244, #243 and #245 in that
dependency order. PR #239 records the final review and signing configuration.
The implementation plan, findings and evidence are in
`docs/qa/2026-11-12-pr-integration-review.md`; PR #239 holds final closeout identifiers.

- Bounded provider and native response reads; fixed completion replay and pending-lease
  cleanup; enforced sign-in deadlines and grant cleanup; hardened account switching,
  refresh scope checks and dormant signed builds. Preserved concurrent implementation
  fixes and archived history. Corrected release and connector acceptance claims.
- #243 CI passed 5,805 tests, skipped 230 and failed none. Native CI compiled the app
  and Swift helpers and passed 161 Rust tests. Final #239 source passed 5,777 local
  tests; its 29 failures are the known Unix-socket `EPERM` restriction, with 230 skipped.
  Lint, typecheck, web build, governance and focused release-credential checks passed.
- Hosted Supabase matches all 116 source migrations. The new pending-only release RPC
  has authenticated-only grants and rejected a sessionless call. Both Vercel production
  projects reached READY at `a48e1bbd`; public login, export rejection and marketing
  checks passed. Live environment flags were not independently readable.
- The feature stays hidden, and Ticket 300 remains deferred. L-019 and messaging review
  remain activation gates. Chromium and the external design verifier are unavailable
  here; no visual pass is claimed.
- Mac publication remains blocked on execution access to the configured release and
  test Macs. Both feeds remain 0.1.9. The retained `c67ec4d1` candidate predates the new
  native code. Build a new dormant candidate and finish ordinary installed acceptance;
  include default-off Cadence disconnect and cancel-link, which now invoke native
  Keychain cleanup. Release is already authorized.

Platform impact: web and desktop source, additive hosted RPC and release records;
marketing deployment verification; future mobile, none. Messaging impact: P-029 and P-032.

## PR #245 connector acceptance record review — November 12, 2026

Follow-up to the November 11 connector entry, which PR #243 archived unchanged.
The reported Outlook production run passed with a personal Microsoft account: consent,
calendar selection, timed/all-day fixtures, Timeline at 1280 and 390 px, disconnect and
reconnect. Cross-tenant consent, `admin_approval_required` and unverified-app-blocking
tenants remain unexercised under the recorded owner decision. Evidence:
`docs/qa/2026-11-11-connector-acceptance.md`. No live acceptance or account access ran
in this documentation review.

- The existing iCloud vault item was unreadable, and no usable Apple test identity was
  available to that run. Initial missing-item preflight results are marked as historical.
- PR #239's release packet records 0.1.10 installed and Hevy timing shown on the test Mac.
  The remaining dependency is installed connector acceptance, not another installation.
- Outlook remains connected for later runs. Post-run provider-grant revocation remains
  an open Ticket 241 step 6 follow-up; disconnect/reconnect smoke did not complete it.
- Ticket 300's deferral and the hidden ChatGPT plan track from PR #244 are unchanged.
- Integrated reviewed PR #243 commit `e0774ac1`; all product files and archived history
  remain identical to that candidate.
- Checks: `npm run agents:check` and `git diff --check` passed. Only the three connector
  documentation files differ from PR #243; no runtime checks were needed for this record
  correction.

Platform impact: documentation only across web and desktop; marketing and future mobile
unchanged. Messaging impact: none; Ticket 241 step 7 remains in the messaging track.

## PR #243 integration review — November 12, 2026

Reviewed Ticket 299 on merged PRs #240 and #241. Preserved the concurrent device-only
availability fix and PR #244's owner pause. The feature remains hidden; Ticket 300 is
deferred until activation. Implementation plan and evidence:
`docs/qa/2026-11-12-chatgpt-plan-review.md`.

- Fixed env-file activation of signed releases by pinning the build flag off. Dev builds
  can still enable it explicitly. Real Vite env-file regressions cover both file names.
- Moved native plan-scope checks under the session lock and rechecked after refresh,
  preserving rotated refresh tokens even when the provider narrows the grant.
- Bound native status and model work, cancelled changed-grant attempts, and released
  pending leases after every post-prepare failure. Preserved the reviewed pending-only
  RPC, completed-attempt replay protection and strict no hosted fallback.
- Blocked account changes after Keychain cleanup failure. Added cleanup when cancelling
  the first account link, guarded stale controls and late responses, and invalidated
  ready and remembered briefs when the connection changes.
- Fresh dependencies, governance, lint (six existing warnings), root and desktop
  typechecks, web/desktop/marketing builds, marketing checks and Public Trust/source
  checks passed. Full suite: 5,776 passed, 230 skipped, 29 Unix-socket `EPERM` failures
  in unchanged infrastructure tests. Focused suites passed 94 and 60 tests; the final
  fixture-only type corrections passed a further 38-test rerun.
- Native Rust needs GitHub CI; no compiler is installed here. The design-system verifier
  is absent, and Chromium fails on `socket()` with `EPERM`, so no visual pass is claimed.
  No live sign-in, feature activation or release ran. Live flag values were not verified.

Platform impact: desktop, hidden plan UI and account isolation; web, shared launcher
invalidation support with no new hosted behavior; marketing and future mobile, none.
Messaging impact: P-045 adds fixed account/connection guard errors; other activation
gates remain in P-029 to P-031, P-046 and L-019.

## Ticket 299: ChatGPT plan UI and Daily Brief wiring — November 12, 2026

Implemented in source on PR #243, based on merged PRs #240 and #241.
Hidden, per the owner's November 12 decision.

- Switch: `VITE_CADENCE_CHATGPT_PLAN=1` at build time (`apps/desktop/src/chatgpt/plan-switch.ts`).
  A default build creates no ChatGPT connection, renders no card and keeps today's hosted
  Daily Brief. Tests prove both.
- Release: `POST /api/advisor/brief/device/release` verifies the envelope and binding as
  complete does and uses Ticket 298's pending-only release RPC. Completed attempts and
  replacement leases remain unchanged. An expired envelope returns `context_expired`.
- Mac: `chatgpt_access_token` returns only a fresh access token, held in memory for one model
  call. The CSP adds exactly `https://api.openai.com`. With plan usage and
  `deviceModelAvailable`, the brief runs prepare, the plan call and complete, and releases on
  any failure after prepare. No fallback to Cadence's key (D27). Disconnecting the Cadence
  account or cancelling its first link first disconnects ChatGPT; storage failures stop
  the account change.
- UI: the "Use your ChatGPT plan" card (`components/briefing/ChatGptPlanCard.tsx`) and the
  bubble's plan states, with bench states at 352px, `DESIGN.md`, INT-SETTINGS-019 to 021
  (internal QA guidance) and the updated INT-AUTH-012 and 013.
- Platform impact: web, the release route only, no UI; desktop, this ticket; marketing, none
  until release (P-032); future mobile, not applicable. Messaging impact: P-045 and P-046;
  P-030 and P-031 text unchanged. L-019 records the clauses followed and the logo gap.
- Original author checks: agents, interactions, resolvers and design-system checks, typecheck, desktop
  typecheck, lint (six existing warnings), build and desktop build passed. `npm run test`:
  5,882 passed, 1 failed (`tests/acceptance-local-stack.test.mjs`, spaces-in-path entry
  point; this branch does not touch it). Rust lib tests: 157 passed. No live sign-in, Tauri
  bundle, Dagger or Vercel change.
