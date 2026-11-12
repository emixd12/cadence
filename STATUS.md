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
| Tickets 301–309: Settings regroup and simplification | Merged to `main` November 11 as PR #205 (`6dd414f8`); all six hosted migrations pushed; Daily Brief grant retired; signed-in hosted check passed November 11 as test account A at 1280 and 390 px | Owner sets the Google Maps spend cap, then an agent runs one hosted Home lookup (308); owner deletes the vault item `google-calendar-agent-retire-secret`; owner reads `docs/qa/2026-11-10-settings-wording.md`; installed Mac check (302) waits on the Mac 0.1.10 release (credential backup is Ticket 325) | TICKETS, Tickets 301–309; STATUS, "Tickets 301–309 hosted verification — November 11, 2026" |
| Tickets 310–324: connector completion (D28) | 310–319, 321 and 322 merged to `main` with PR #207 on November 11, 2026, off behind `CADENCE_CONNECTOR_COMPLETION`; hosted migrations `20261111140000` and `20261111150000` applied November 11; Hevy read by events cursor (strategy A) | Ticket 320 (contract 5, SQLite schema 24) merged with PR #216, hosted `20261111160000` applied: installed acceptance on a dev-signed build. Mac 0.1.10 with Tickets 319 and 320 published November 12; Ticket 323 waits on Ticket 241's release steps 6–7 and installed connector acceptance; then the flag turns on by owner instruction. 324 after 323 | TICKETS, Tickets 310–324; STATUS, "Connector completion hosted push and merge — November 11, 2026" |
| Ticket 326: configuration history in two key shapes (defect D2, web export 500) | Read-side fix on branch `claude/fix-export-camelcase-60ae30`: export, BehaviorLog restore and Daily Brief history normalize camelCase snapshots; the export route logs failures | Merge and check export as account A on production; Mac account sync still uploads camelCase snapshots (writer fix ships with a later Mac release); optional data migration needs the owner's approval | TICKETS, Ticket 326; STATUS, "Ticket 326: web export reads Mac-written configuration history — November 11, 2026" |
| Ticket 293: test-access preflight | Merged November 10, 2026; awaiting verification | First live preflight run per suite | TICKETS, Ticket 293; STATUS, "Ticket 293: test-access preflight for acceptance runs — November 7, 2026" |
| Tickets 294–300: Daily Brief on the user's ChatGPT plan | 294–298 merged; 299 implemented on PR #243, under review, hidden behind `VITE_CADENCE_CHATGPT_PLAN`; 300 deferred | Paused by the owner on November 12: the feature stays hidden and Ticket 300 waits until the owner turns it on. The production device-model flag must stay unset; L-019 logo gap and P-029 to P-031, P-045 and P-046 messaging review remain activation gates | TICKETS, Tickets 294–300; `docs/DECISIONS.md`, 2026-11-12 |
| Tickets 289–290: Daily Brief prompt, model and effort candidates | Candidates in the development workbench; production pinned; comparison on H1–H10 and S1 prepared November 11 | Owner sets a spend cap (US$2 asked) and optionally names extra models; agents run the comparison; the owner promotes or rejects under Ticket 184's rules | TICKETS, Tickets 289–290; `docs/qa/daily-brief-prompt-consolidation.md`, "Prepared owner comparison" |
| Ticket 291: skill-rule acceptance scenarios | Local-stack run with `claude-code` passed all three scenarios November 11 | Production run with the API clients; needs a spend cap for the QA keys | TICKETS, Ticket 291; `docs/qa/mcp-server.md`, "First local run — November 11, 2026" |
| Leave reminder send-time Calendar read (follow-up) | Entry says "not pushed"; `git log` shows PR #200 merged as `2d16bf12` | Deployment not recorded: unclear — see source | STATUS, "Follow-up: keep a leave reminder when the send-time Calendar read fails — November 8, 2026" |
| Behavior place edit withdraws its leave time (web) | Entry says "not pushed"; `git log` shows PR #198 merged as `d643a6e7` | Not yet rechecked live | STATUS, "Follow-up after the Wave 6 deploy: a Behavior place edit withdraws its leave time — November 7, 2026" |
| Mac leave reminders for newly added Calendar events | PR #198 in 0.1.10; installed run on November 12 inconclusive (event too close to plan a reminder) | Rerun on the test Mac with an event at least two hours ahead | STATUS, "Cadence for Mac 0.1.10 published — November 12, 2026" |
| Updater key rotation and new Developer ID identity | 0.1.10 published November 12 with the rotated key and new identity; 0.1.9 and earlier install it by hand once | Renew the certificate before December 11, 2027 | DECISIONS, 2026-11-11; STATUS, "Cadence for Mac 0.1.10 published — November 12, 2026" |
| First account link times out for a large account (found November 12) | Hosted `apply_account_sync_plan` exceeds the `authenticated` statement timeout for the owner's 4.99 MB snapshot; the owner's Mac is linked with no data | Fix the hosted function (timeout or cheaper compare) and retry the owner's first link; show the real error on the Mac | STATUS, "Cadence for Mac 0.1.10 published — November 12, 2026"; `docs/qa/2026-11-12-desktop-0.1.10-release-packet.md` |
| Ticket 325: release credential backup and restore | Vault, service account and all four backups (identity, notarization password, updater key, API key) verified November 12; notarization uses the API key (0.1.10) | Certificate-renewal spike | DECISIONS, 2026-11-11 (D29); TICKETS, Ticket 325; STATUS, "Ticket 325: live backups verified — November 12, 2026" |
| Cadence for Mac 0.1.10 | Published November 12, 2026 (0.1.9 published November 7) | macOS 14 not tested; 0.1.9 and earlier install 0.1.10 by hand once (rotated updater key) | STATUS, "Cadence for Mac 0.1.10 published — November 12, 2026" |
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
| Connector Tickets 236, 240–242 (Hevy, iCloud, Outlook) | Hevy and Outlook (personal account) passed on production web November 11; cross-tenant Outlook checks skipped by owner decision; PR #239 records 0.1.10 installed and Hevy timing shown without titles | iCloud (240) and its part of 241 step 6: no usable test identity; existing vault item unreadable; owner decides between their own Apple Account and waiting. Remaining installed connector acceptance is open; 241 step 7 copy is live and awaits the owner's review | TICKETS, Tickets 236, 240, 241, 242; STATUS, "PR #245 connector acceptance record review — November 12, 2026"; PR #239 release packet |
| Tickets 243–244: travel backlog | Filed October 22; backlog | None scheduled | TICKETS, Tickets 243–244 |
| Daily Brief release acceptance (grouped): Tickets 147, 148, 155, 161, 168, 169, 172, 173, 174, 182, 183, 185 | In progress or implemented in source; reconciled October 27: still open | Ticket 174 carries hosted, deployed-web and installed-desktop gates; 182–183 owner-run live checks; 185 awaits owner product decisions | TICKETS, Ticket 174 and each listed ticket |
| Google Calendar Timeline (grouped): Tickets 133–137, 141, 150 | In progress; reconciled October 27: still open | Post-approval web and native consent smoke checks; 137 provider-failure, Workspace and installed fixture cases; 150 live custom-name check | TICKETS, Tickets 137, 141, 150 |
| Earlier travel tickets (grouped): 160, 162–164, 166, 167, 170, 171 | Implemented in source or discovery complete | Release gates sit in Tickets 165 and 174; owner re-acceptance for 166–167 | TICKETS, each listed ticket |
| Desktop release follow-ups (grouped): Tickets 142, 143 | Complete in source; web deployed September 18 | Installed-native release acceptance | TICKETS, Tickets 142–143 |
| Operations (grouped): Tickets 091, 104, 105, 128 | 091 and 105 in progress; 104 and 128 blocked; reconciled October 27 | 104: operator diagnostics or an authorized route test; 105: verify deployed browser-push delivery after the reviewed web-push 4.0.0 upgrade; 128: a revised candidate needs a new measured gate | TICKETS, Tickets 091, 104, 105, 128 |

## Recent entries

## Cadence for Mac 0.1.10 published — November 12, 2026

The owner instructed notarization in chat. An agent built 0.1.10 from `main` at `c67ec4d1`
(the same app source as PR #223's merge) on the owner's Mac. Apple accepted the app and DMG,
notarized for the first time with the App Store Connect API key (D29.4). **Published
05:29–05:33Z** on the owner's instruction; both feeds and the download link serve 0.1.10.
Packet: `docs/qa/2026-11-12-desktop-0.1.10-release-packet.md`.

- **Checks 1–3 pass:** CI, 14 artifact checks, notarization and quarantined download, and the
  upgrade from published 0.1.9 on the test Mac (schema 20 → 24, no table lost rows). The owner
  approved returning the test Mac to 0.1.9 first; its dev.2 state is kept in
  `backups/pre-restore-0.1.9-20261112T031457Z/`.
- **The Keychain session from 0.1.9 survived the new certificate**, with no prompt; location
  stayed allowed.
- **Check 4 cannot run:** 0.1.9 rejects the rotated updater key, so installs upgrade by hand.
- **Area checks:** Calendar callback replay, session renewal, and revoked session with reconnect
  pass (the owner authorized revoking account A's test-Mac session).
- **Tickets:** 302 passes in linked and local mode (complete). 320 and Hevy (236) show on the
  Mac. The leave-reminder recheck for newly added Calendar events was inconclusive.
- **Owner's Mac:** had no Cadence; 0.1.10 installed from the DMG. The owner signed in, but the
  first link fails: hosted `apply_account_sync_plan` hits the statement timeout for the owner's
  4.99 MB snapshot. Not a 0.1.10 regression (contracts 2–5 send the same payload); open-work row
  below.
- **Tooling:** the fixture tool's Google OAuth client is missing from the keychain (lost on
  November 9); the agent made the test event through Calendar on the web in the QA profile.

Platform impact: desktop release only. Web, marketing and future mobile: not applicable.
Messaging impact: none.

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

## PR #240 integration review — November 12, 2026

Integrated the device routes with the reviewed PR #238 source (`2601bac8`), including
PR #242's owner decisions. Earlier status entries and archived history are preserved.

- Added `/api/advisor/brief/device/release` and the authenticated, pending-only
  `release_daily_brief` RPC. Migration `20261112043335_release_pending_daily_brief.sql`
  preserves completed attempts, replacement leases, daily admissions and rate limits.
- Fixed complete-request replay downgrading a successful attempt. Only a request that
  completed its own lease may undo it after a failed final context fence. Complete also
  rechecks context expiry after the final fence. No hosted model behavior changes.
- Fresh `npm ci`, agents, interactions, resolvers, full lint, typecheck and web build
  passed. Lint retains six existing warnings. The full suite passed 5,729 tests and
  skipped 230; 29 failed because this executor denies Unix-socket binding (`listen
  EPERM`) in the unchanged session-broker and Docker-proxy suites. An additional
  consumer-test failure under a dependency overlay disappeared after fresh `npm ci`;
  no product change was needed for it.
- Local `supabase db reset --local` failed before reset because Docker socket access is
  denied. The SQL ownership, replay and quota regression runs in Local Supabase
  rehearsal. GitHub CI and Local Supabase rehearsal passed on `968ebeaef`.
- Applied the reviewed SQL to hosted Supabase as migration `20261112043335` after
  rehearsal. All 116 migration versions match source. The source filename follows
  the provider-assigned version; SQL bytes are unchanged. Generated types differ
  only by the new RPC and match its source type. Hosted grants allow authenticated
  users only; an authenticated role without a session is rejected. No table shape,
  RLS policy, admission counter or existing row changed during deployment.
- The production device-model flag must stay unset under PR #242. No activation
  occurred; live environment values were not independently verified. Ticket 299
  wires the hidden client and release call.
  This change adds no desktop schema or sync-contract change.

Platform impact: web, gated device routes; desktop, Ticket 299 consumes them; marketing
and future mobile, not applicable. Messaging impact: P-029, unchanged.

## Ticket 297: Mac app ChatGPT connection — November 12, 2026

Cadence for Mac can connect, refresh and disconnect one ChatGPT account (D27). Branch
`claude/ticket-297-mac-chatgpt`, PR #241. No UI uses it until Ticket 299, whose desktop
switch stays off by default under the November 12 owner decision.

- Rust (`apps/desktop/src-tauri/src/chatgpt/`) runs discovery, the one-shot `127.0.0.1`
  callback listener, code exchange, RS256 ID-token validation, the plan-scope check,
  single-flight refresh, revocation and the catalog read. The webview gets state, email
  and `slug`/`visibility` rows through `apps/desktop/src/chatgpt/connection.ts`.
- Tokens and the per-installation host ID stay in two native-only Keychain items,
  `chatgpt-installation` and `chatgpt-session`. The webview secret commands refuse both.
  The CSP is unchanged.
- Direct dependencies `reqwest`, `rustls`, `ring` and `base64` were already in
  `Cargo.lock` through the updater; the lock adds no crate.
- Mocked tests pass: 22 new Rust tests (154 Rust lib tests in all) and 6 TypeScript tests,
  including one that scans an export, two backups and the database for ChatGPT values.
  No live sign-in ran. Installed acceptance is Ticket 300.
- PR review added streaming response limits, a callback deadline that incomplete requests
  cannot extend, grant revocation after failed Keychain persistence, and strict issued-at,
  audience and authorized-party validation. Three new native regressions cover response
  limits, stalled callbacks and persistence failures. The six TypeScript connection tests
  and governance checks passed; Rust is unavailable in the review executor. The reviewed
  head still requires GitHub Desktop native CI. These changes do not enable the plan path.

## Ticket 298: Daily Brief device prepare and complete — November 12, 2026

Implemented in source on `claude/ticket-298-device-brief`; not pushed or deployed.

- `POST /api/advisor/brief/device/prepare` admits the attempt, builds the context and
  returns the model request with a signed envelope. `/complete` verifies the envelope and
  lease, validates the device's output, finishes the lease and records the tip. The server
  makes no model call on this path and stores no prepared payload.
- The envelope is HMAC-SHA256 signed under `CADENCE_DAILY_BRIEF_ENVELOPE_SECRET` and
  expires with the 75-second lease. It binds the user, installation, lease, preferences,
  configuration and context revisions. `readBriefingContextFence` lets complete fence the
  stored inputs without a capture in memory. Recipe 1.0 only.
- `CADENCE_DAILY_BRIEF_DEVICE_MODEL` gates the mode, off by default. Settings report
  `deviceModelAvailable` without `OPENAI_API_KEY`.
- Platform impact: web, the hosted routes and flag; desktop, Ticket 299 calls them;
  marketing and future mobile, not applicable. Messaging impact: P-029 (data flow note).
- Checks: agents, interactions and resolvers checks, typecheck, lint (six existing
  warnings) and build passed. Vitest on the 50 Daily Brief, briefing and advisor test
  files: 769 passed. Dagger was not run. Vercel variables are owner-gated and unset.

## Ticket 296: ChatGPT plan adapter — November 12, 2026

**On branch `claude/ticket-296-plan-adapter`.**

- `lib/services/daily-brief-chatgpt-plan.ts`: catalog read, model choice in the owner's
  order (`gpt-6.1-sol`, `gpt-6.1-terra`, `gpt-6-luna`; none listed means not eligible, no
  fallback), the plan request body, SSE reading without a Content-Type, a 256 KB stream cap
  and 64 KB output cap, and error mapping to `usage_limit`, `not_eligible`, `reconnect`,
  `retry_later`, `advisor_unavailable` and `timeout`. Browser-safe; no bodies logged.
- `lib/services/daily-brief-schema.ts` holds the output schema both adapters share;
  `daily-brief-openai.ts` imports it, so the hosted request is unchanged.
- Tests: `tests/daily-brief-chatgpt-plan.test.ts` (16). The briefing, Daily Brief and spike
  tests pass. Ticket 296 is complete; 297 and 298 can start.
- Platform impact: web, none (hosted path unchanged); desktop, the adapter Ticket 299
  wires in; marketing and future mobile, not applicable. Messaging impact: none.

## Ticket 295: ChatGPT plan spike passed live — November 12, 2026

**On branch `claude/brief-chatgpt-plan-086210`.**

- The owner signed in with ChatGPT Pro three times on November 12 (UTC). The third run
  passed. Results and recommendations are in `docs/qa/2026-11-07-chatgpt-plan-spike.md`.
- Sign-in, the `chatgpt.tokens.use.direct` grant, the catalog (10 models), refresh with
  rotation and revocation work. CORS allows `tauri://localhost` on both endpoints.
- Daily Brief through Cadence's validation: `gpt-5.6-luna`, `gpt-6.1-terra` and
  `gpt-6.1-sol` valid on 8 of 8 fixtures; `gpt-6-astra` 7 of 8 (one
  `server_is_overloaded`). Slowest call 14.3 s; none over 30 s.
- The plan route rejects `background`, a string `input` and `stream: false` with 400. It
  accepts strict `json_schema`, `reasoning`, `tools: []` and `max_output_tokens`.
- Spike fix: the plan route's streaming 200 has no `Content-Type`. The first two runs read
  those replies as JSON and marked them interrupted. `scripts/chatgpt-plan-spike.ts` now
  reads any non-JSON reply as SSE; the mock omits the header, and a test covers it. An
  uncommitted diagnostic edit (event names and content type in the probe report, no
  bodies) appeared in the worktree during the first run; it is kept and committed here.
- The owner approved the recommendations on November 12 and set the model order:
  `gpt-6.1-sol`, `gpt-6.1-terra`, `gpt-6-luna` (`gpt-6-luna` untested).
- Next: the Ticket 296 adapter, then Tickets 297 and 298.
- Platform impact: none (development script and QA record). Messaging impact: none.

## Ticket 325: live backups verified — November 12, 2026

The owner created the Cadence Release vault and its read/write service account and stored
the token in the login keychain (service `cadence-release-1password`). With the owner's
`release-secrets` approval in chat, recorded in `.intent/acceptance/mac-0.1.10-20261111`,
an agent ran `backup` for the identity, the notarization credential and the updater key.

- **Verified:** `verify-backups` reports all three items complete with matching
  fingerprints. The `desktop-release` preflight shows `release-vault-token` and
  `release-backups` ready.
- **Fixed in `release-credentials.mjs`:** `op item create` ignored a template on Node's
  stdin pipe (a socket, not a FIFO) and created "Untitled SecureNote" items, so `backup`
  now passes a 0600 `--template` file and checks the returned title. Attachment names with
  periods (`identity.p12`, `cadence-updater.key.pub`) are escaped. Two Untitled items and
  one partial updater item were deleted from the vault. `tests/release-credentials.test.mjs`
  covers both (14 pass).
- **Still open:** the App Store Connect API key (owner creates it), switching notarization
  to it, and the certificate-renewal spike.
