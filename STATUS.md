# Implementation Status

## Ticket 186: Cadence project and repository rename — October 7–9, 2026

In progress; local and remote cutovers are done.

- Local: the physical folder is `/Users/emi/Coding Projects/cadence`; the old path
  is a compatibility symlink. Codex uses the new root under the same project ID;
  the owner confirmed fresh sessions work. Both Codex automations remain PAUSED.
- GitHub: `emixd12/habit-tracking-app` is now `emixd12/cadence` (same ID
  `1261353608`); settings, refs and releases are unchanged and old links redirect.
  All 76 legacy Trust evidence files serve identical bytes from `emixd12.github.io`.
- Production: PR #92 merged `main` with the already-deployed `9eda5c0` history.
  After PR #94 (`610e938`), app `dpl_CzeNWirHRMwgWGNuK4VzXwStiQRV` and marketing
  `dpl_2U3cA6da16hVJisjr9pqeJhU8Agw` serve the production domains. Each merge to
  `main` requires updating the app's `CADENCE_TRUST_MARKETING_DEPLOYMENT_ID` and
  redeploying the app.
- Trust: publishes from `https://emixd12.github.io/cadence/` with 37 legacy plus
  new snapshots. Provenance passes again. `hosted_migration_boundary` fails
  because unmerged branch `codex/fix-daily-brief-cpu-retries` applied hosted
  migration `20260927173716`; this predates the rename.
- Updater: feeds, archives and signatures pass through old and new URLs.
- Task 9: production screens, local Supabase data and builds from the new folder
  pass. Popmelt was removed on October 9 after the move changed its path-derived
  project ID; its data is archived in the private rename backup.
- `main` was merged into `claude/tickets-169-173-advisor-analysis` on October 9.

Open: native updater acceptance, the next scheduled Trust run and Task 10
residual-reference classification. Evidence: `docs/qa/cadence-project-rename.md`;
plan: `docs/plans/2026-10-07-cadence-project-rename.md`.

## Function

`STATUS.md` is the current-state ledger for this repository. Future agents should read it immediately after `AGENTS.md` and before selecting work from `docs/TICKETS.md`.

Its job is to answer:

- What has already been implemented?
- What is currently in progress?
- What is blocked, deferred, or intentionally not started?
- Which verification commands were run for completed work?
- Which files, docs, or contracts changed during each ticket?
- What risks or follow-up items should the next agent know before continuing?

`STATUS.md` does **not** replace the product docs. It does not define feature scope, product behavior, UI requirements, data contracts, or source-of-truth precedence. Use:

- `AGENTS.md` for operating rules and source-of-truth order.
- `docs/TICKETS.md` for ticket scope and acceptance criteria.
- The other files under `docs/` for product, data, recurrence, notification, export, UI, and user-flow contracts.
- `STATUS.md` only for implementation state and handoff continuity.

## Tickets 182–185 briefing exploration and owner decisions — September 28, 2026

Tickets 182–183 are implemented in the existing development workbench. Historical
inspection defaults to 14 prior days, caps target ranges at 90 days, and labels
current retained account rows Retrospective. Reconstruction remains unavailable.
Missing records, original completion counts, elapsed history, Notes and reminder
state remain unknown. Historical planning cannot infer free time from retained rows.
Optional past Calendar uses live authorization and stays separate from pattern history.

Days supports saved-day A/B review, no-model selection simulation, diagnostic lane
previews, explicit call budgets and cancellation with retained partial output.
All workbench tabs share at most two active calls and a default 100-call rolling-hour
budget. Failed and dispatched cancelled calls count; queued cancellation releases
reservations. Local reports preserve complete visible text and exact feedback.
Production admission, tip history, storage policy and presets remain unchanged.

Ticket 184's owner criteria were recorded September 30, 2026: actionable adherence
analysis and day planning, a general one-minute read, longitudinal quiet-day insights,
and varied lanes with justified repeats for important patterns. Initial coverage is
`daily-brief-balanced@1`: six tuning cases, ten reserved cases and a seven-day sequence.
Profile revisions and evaluation iterations are recorded separately in the packet
and existing QA record. Iteration 1 has not run. Private comparisons, quality
acceptance, candidate promotion, rollback execution and release gates remain open.
Ticket 185 has a concrete lifecycle proposal; every product decision remains pending.
Owner packet: `docs/plans/2026-09-28-briefing-owner-review.md`.
Implementation and verification: `docs/qa/briefing-workbench.md`.
Existing desktop release work and prior briefing changes remain intact.
Verification: 2,519 tests pass with 29 opt-in skips using two workers and a
30-second test timeout for existing desktop subprocess checks. Governance,
core/design-system, lint, web/desktop TypeScript and web/desktop builds pass.
Browser QA verifies 390 px and 1440 px layouts, no-model planning and draft retention.
Fresh independent read-only review returned `ship` after correcting the source freeze
and two Days state defects. Three regression tests cover the UI corrections.

## Remaining signed-release tickets — September 28, 2026

The owner requested explicit tickets for the remaining release work. Tickets
178–181 are authorized for execution: signed account/Calendar lifecycle; notification activation and
sleep/wake; real preview-to-signed updater acceptance; final acceptance/publication.
Ticket 115 stays in progress as the umbrella. Ticket 165 retains location and Maps
handoff, with the signed rc.2/rc.3 timeout now reflected in its current state.
Preparation can proceed independently; live installed-app tests must be serialized.
Ticket 180 follows account-transition evidence, and 181 follows 178–180 while
reconciling 165's separate travel gates. macOS 14 testing remains owner-deferred.
Execution started after the owner requested all four release tickets. All 76 current
migrations replayed in the separate `cadence-release-20260928` local project.
The real authenticated adapter contract and 92 RLS ownership checks passed.
The smoke fixture needed seven location-history fields to match the existing schema.
Post-run counts confirmed temporary-account cleanup. All ports stayed on loopback;
the stack and proxy stopped, and existing volumes remained intact.
Controlled-feed preview.46 built and passed independent parent artifact verification.
Earlier September 29 checkpoints (superseded by completion below): owner Keychain
approval resolved source launch. The separate QA feed
and signed target are published. Wrong-signature, tampered-archive and unavailable
stages failed safely. Native Install replaced the bundle with the exact notarized
rc.3 executable. Explicit Restart launched a new process; the owner confirmed its window is visible.
Independent comparison passed domain preservation across all 30 tables; only
sync timestamps and reminder bookkeeping changed. Interruption recovery remains unverified.
Original preview.45/full primary data are restored and verified; retained evidence
lives under `updater-20260929`. Account data is current, automatic downloads are
enabled and latest original reminder readback is 99/434. Updated rc.3 readback was 2/434
after owner refresh. Investigation found source preview.46 already at 4/434 before
installation, OS “Too many requests” drops, and simultaneous old-build pending
schedules (97 preview.45 + 1 preview.46, including a duplicate identifier).
Controlled withdrawal confirmed old-source capacity competition: removing five old
requests let rc.3 retain exactly five, alongside 95 older-source records. Cleanup
preserved all 46 delivered identifiers. Original app/data are restored and verified;
evidence lives under `withdrawal-20260929`. Consecutive signed rc.2/rc.3 continuity
now passes: both use one source and retain the same five available requests.
`signed-continuity-20260929` records restored app/data and unchanged delivered history.
Historical preview.45 migration now passes: withdrawing its 99 requests lets rc.3
retain the exact same 99. All 46 delivered identifiers survive; original app/data
are restored. Preview.46 retains one owner-blocked request. A UI-created three-row
pending outbox survives restart and strict fixture validation; actual updater
preservation and interrupted recovery remain open. The delivered-history cleanup
fix passes fresh review and required regression/build checks. Fixed rc4 and signed
preview.47 preparation stopped before credential access: automatic approval review
requires owner authorization for Apple notarization. See the QA owner checklist.
Ticket 180 is complete September 29. Explicit credential-and-Apple-submission
authorization enabled notarized rc.4 and signed preview.47 app/DMG builds; both pass
all artifact checks. Native interrupted-download/Retry, Install and separate Restart
pass on signed preview.47→rc.4. Strict preservation passes all 30 tables and all three
pending outbox rows. Seven reminder identities/fire times survive the real updater.
Installed rc.4 preserves a delivered notification during reconciliation and unverified
pending cleanup, then removes only that synthetic notification when its Occurrence
is Completed. The historical source migration and signed continuity evidence resolve
the observed capacity competition; preview.46 now has zero pending requests.
The original preview.45 app and full primary data are restored and verified. Account
data is current; automatic downloads are enabled. Final native readback is 100/434,
with 100 unique original-source requests and no temporary signed requests. All 56
protected delivered identifiers remain. The QA feed is restored byte-for-byte to rc.3;
the public desktop-preview feed is unchanged. The relay is stopped. No owner action
remains for Ticket 180. The QA record contains the final acceptance matrix and exact
artifact, preservation and rollback evidence. Tickets 178 and 181 remain separate.
The owner’s clean M2 Pro MacBook Pro on macOS 26.7 opened rc.3 normally and linked
the dedicated test account. Offline creation/status/Note, restart persistence and
reconnection passed. Chrome confirmed exactly one matching Behavior and matching
Completed status and Note. Second-Mac notification permission and OS readback pass:
30/30 reminders cover the full target through October 29 at 11:03:50 EDT. This does
not explain the first Mac’s different-load 2/434 result. No public feed change or
final publication ran.
The dedicated test Calendar now has a timed public-landmark event without guests
or notifications. The owner selected Chrome, confirmed test-account sign-in,
and is available for notification/sleep-wake checks. A second Mac is available
for location acceptance. The restoration manifest and retained QA copies live
under `owner-assisted-lifecycle`. Signed rc.3 passed Notification Center activation,
actual sleep/wake reconciliation, notification permission revocation/recovery,
Calendar pending-state restart/cancellation/cleanup, and timed event rendering.
Google Maps search handoff opened the public-landmark destination in Chrome;
Ticket 165 now has owner-observed second-Mac foreground acquisition after manually
enabling Location Services. Missing initial prompt and first-Mac timeout remain open. Wrong-account reconnection
rejected the dedicated test identity against copied primary data; strict 30-table
preservation passed. Same-account reconnection and restart persistence passed;
post-sync domain/history comparison passed independent review. Original app/data restoration
and primary reminder readback passed. Ticket 179 is complete; 96 of 433 eligible
primary reminders are retained with truthful limited coverage. Automatic downloads
returned to their original enabled setting at the September 28 checkpoint. Session/replay checks in 178
and final publication in 181 remain open; Ticket 180 is complete as recorded above.
The concurrent numbering collision is resolved: Daily Brief follow-ups use 182–185.
Verification: governance/parity/design checks, lint, web/desktop TypeScript, web and
marketing builds, 109 native tests, six crypto tests, 20 SQLite contract tests, and
48 focused release/RLS tests pass. Full-suite failures were socket restrictions and
timeouts; affected files passed scoped reruns, with a 30-second timeout for the
46 subprocess-based release-acceptance tests. One SQLite capacity test remains opt-in.
Fresh independent review of the exact QA endpoint allowlist and seven RLS fixture
corrections returned `ship` with no findings on September 28. Installed updater
acceptance subsequently passed under Ticket 180 on September 29.

## Tickets 175–177 briefing review workbench — September 28, 2026

Owner-requested review corrections pass automated checks. Fresh independent read-only
review returned `ship` with no actionable findings after correcting its first three findings.
Confirmed fixes cover saved-rerun consent, retention, storage errors, candidate
lineage, anchored feedback, stale reads, unsaved rerun visibility, and reading/quotation
consistency. Tickets 182–184 cover remaining bench phases. Ticket 185 owns the
separate stored-brief product decision. Parallel Ticket 115 work remains separate.

Review verification: agents, interactions, resolvers, core, design-system, lint,
TypeScript, desktop typecheck/build and web build pass. The full suite passes
2,467 tests with 29 skipped using two workers. The initial default-worker run had
one timeout in a parallel desktop release test; that file passed separately.
The workbench has 40 passing DOM tests. Browser checks at 1440 px and
390 px confirm equal/stacked columns, closed configuration controls, keyboard editing,
long-text wrapping and visible unconfigured-provider errors. No private capture,
provider generation, schema change or deployment ran during this review.
The shared bubble now uses consistent en-US times in the briefing timezone so
rendered quotations match server validation. Actual prose quality still needs owner
review; the production preset remains unchanged.

The owner asked to implement Phases 0–2 of `docs/plans/2026-09-27-briefing-bench-review.md`
and authorized full account capture for local reviews. Tickets 175–177 are complete in
source. Their initial implementation added the shared `realistic-timing` fix, which
only matters once `advisor-analysis` is promoted. The review also aligns shared time
formatting as described above; production generation policy remains unchanged.

- 175: midnight-ending ranges end the next day in `realistic-timing`; plain-language lane,
  state and tip-decision labels; reading-burden, repetition and internal-term warnings
  (`packages/core/src/services/briefing-review.ts`).
- 176: the workbench opens on Compare with Saved reviews. Cases, candidates, runs and
  prose feedback persist under `.local/briefing-bench/` (0700/0600, 30-day retention,
  delete). Account cases keep captured inputs for exact reruns.
- 177: review packets for coding agents, validated proposal files, owner decisions, and
  candidate-only reruns on a saved case's captured clock after current consent checks.

Verification: agents, interactions, resolvers, core, design-system, lint, TypeScript,
tests (2,435 passed, 29 skipped) and build pass. An earlier full run failed
`tests/desktop-release-acceptance.test.ts` once under load; it is under the parallel
Ticket 115 edits and passed alone and on the final run. Browser QA ran one synthetic
comparison. See `docs/qa/briefing-workbench.md`. Remaining: owner review of
real account comparisons; Phases 3–5 are now tracked by Tickets 182–184.

## Ticket 115 execution — September 27, 2026

The owner authorized every step of the Apple Developer execution plan, including
computer/browser use. Post-notarization authentication, Calendar, location, reminders,
and distribution acceptance now run under the parallel work plan; the parent owns
all installed-app interactions. Ticket 115 is in progress. The Developer ID Application
identity is installed and valid. Apple's provisioning profile authorizes Cadence's
App ID and Keychain group. Apple accepted the Keychain-held notarization credentials.
Apple accepted both `0.1.1-rc.1` app and DMG notarization. Both staples, Gatekeeper,
and strict artifact verification pass. The release helper now notarizes and staples
the DMG before verification. The hourly monitor remains paused after completion.
rc.2 also passes the full automated notarization/verification path and normal
quarantined Finder installation/first launch. Installed inspection found the
missing public Calendar/Daily Brief endpoint; a reviewed configuration fix now
passes rc.3 app/DMG notarization and strict artifact checks. The dedicated
Google test identity completed rc.3 native login and synchronized successfully.
Sign-in survived normal quit/relaunch; Calendar list, test-calendar selection,
refresh, disconnection, and account sign-out passed. Sign-out survived restart.
The browser completion path was not observed; this does not verify direct Codex
browser handoff or Calendar callback restart/replay. The
original primary app/data are restored and preview.45 runs signed in.
The initial authenticated local Supabase adapter contract passed against the retained
74-migration schema. September 28 verification supersedes that limitation: all 76
current migrations replayed in a separate disposable project and the real adapter
contract passed with verified cleanup. Existing local data remained intact.
The test stack is stopped.
The real native Data Protection Keychain adapter passed synthetic write, update,
cross-process read, and deletion. September 28 rc.3 checks proved copied-primary
launch preservation across 30 tables and 6,326 rows. The release checker now
recognizes only two canonical completed native reminder receipts that launch
reconciliation replaces; pending, malformed, and domain receipts remain protected.
An isolated QA reminder was delivered while Cadence was closed. Notification
activation, sleep/wake, real updater installation, and other installed lifecycle
gates remain open. Signed rc.3 location still times out without a permission grant;
no app defect is confirmed. QA reminders were canceled by archiving the synthetic
Behavior. Original preview.45 and the complete primary directory were restored;
the account is current, all three databases pass integrity/foreign-key checks,
and reminders are refreshed with the existing OS-limited horizon disclosed.
Receipt-check verification passed: 46 focused tests; repository checks, lint,
TypeScript, and build. The full suite had 2,427 passes and 29 skips; all nine
sandbox socket failures passed in the scoped unsandboxed rerun (27 tests).
Fresh independent review returned ship with no findings. Publication remains open.
The owner deferred macOS 14 runtime acceptance without changing the
compiled minimum. See `docs/qa/2026-09-27-apple-distribution.md` for current evidence.

## Historical Apple Developer planning checkpoint — September 27, 2026

At this checkpoint, Apple Developer Program membership became available. Ticket
115 was deferred for execution with its membership blocker resolved. The execution
entry above supersedes this historical planning state. The local signing check returned zero valid identities. The host
runs macOS 27.0 on arm64; macOS 14 acceptance remains unverified. Notarization
credentials were not inspected.

The inventory and execution plan are in
`docs/plans/2026-09-27-apple-developer-unblocked-work.md`. They cover Developer ID,
notarization, production Keychain and Calendar pending-state acceptance,
Gatekeeper, upgrades, and the Ticket 165 location-signing hypothesis. Signing
is not a confirmed location fix. Existing preview tickets remain complete.
No credential creation, build, installation, Apple submission, or publication ran.

Planning verification passed: `npm run agents:check`, `npm run interactions:check`,
and `git diff --check`. Runtime tests and builds were not run for these documentation
changes. No ticket is marked complete by this planning pass.

## Daily Brief web production deployment — September 26, 2026

Deployed application commit `9eda5c039bbf1c6e306a40a2a720f8d0cb02c43a`
to the existing Vercel `cadence` project and promoted Ready deployment
`dpl_9u3Ki7ZjgCnHwGiL9FTVBGNhFt1n` to `https://app.cadence-me.com`.
The owner explicitly requested application deployment after the hosted migrations.
The CLI uploaded a clean `git archive HEAD`; Vercel's `sourceCommit` metadata
matches that commit. Local migration evidence and SQL smoke edits were not part
of the application source archive.

Vercel's production build and TypeScript checks passed. Inspection of the
production domain resolves to the new Ready deployment. Eleven unauthenticated
route checks passed: Login, Privacy and Terms return 200; Timeline, Behaviors,
Settings, Export and Analytics redirect to Login; Daily Brief preferences,
Daily Brief POST and reminder processing reject missing authentication with 401.
Daily Brief GET correctly returns 405 because the endpoint requires POST.
The deployment error-log query returned zero records during the release window.

Rollback target: `dpl_EySiseVj858i81TyfRuYjz8qY6pt`. Both new database
migrations remain applied if the application needs rollback. No provider gates,
Daily Brief preset, marketing deployment or native package changed. Owner-run
private comparisons, authenticated acceptance and installed-desktop acceptance
remain open under Ticket 174. This release does not establish fresh Trust Passed
evidence. Prior local source checks and full build remain applicable.

## Daily Brief hosted migrations — September 26, 2026

Applied `20260926150000_daily_brief_bounded_recovery.sql` and
`20260926170000_daily_brief_analysis_sources.sql` to the linked Cadence project
`qjodzutjxtmtzczbloxa` under the owner's migration request. Hosted history now
matches all 76 repository migrations. Read-only catalog checks confirmed the
three new columns, forced tip-table RLS, denied direct authenticated table reads,
and authenticated-only analysis RPC access. Generated hosted public-schema types
match the checked-in public-schema types exactly; no type change was needed.

Local verification replayed all 76 migration files against disposable Supabase
Postgres 17.6.1.159 with the real GoTrue v2.195.0 Auth schema. No application-data
stubs were used. The container published only `127.0.0.1:55322`. CLI `db reset`
was attempted but requires its managed stack; this was a direct ordered SQL replay,
not a successful CLI reset. The npm CLI wrapper has an invalid macOS signature,
including after reinstalling the exact 2.105.0 package. The package's working
`supabase-go` backend performed history, dry-run, push and type generation.

Updated `tests/sql/ticket-147-daily-brief-smoke.sql` for current preference defaults
and completed-attempt retries. Its rollback-only smoke passes recovery limits,
Calendar fencing, session revocation/expiry, optional-source disclosure,
snapshot revision matching, old-client disclosure revocation, lease-bound tip
records and deletion on disable. Hosted checks read catalogs only; no private
account comparison or synthetic hosted user was created.

Verification: 50 targeted tests pass; agents, interactions, resolvers, lint and
typecheck pass. Full tests report 2,315 passed and 29 skipped, with five sandbox
localhost-bind failures; all seven tests in that file pass outside the sandbox.
The production build passes. Fixture rollback left zero Auth users; the disposable
container and its volume were removed. Application deployment, owner-run comparisons,
and installed-desktop acceptance remain open under Ticket 174.

## Tickets 169–174 advisor analysis, tips and travel — September 26, 2026

Tickets 169–173 are implemented in source; Ticket 174 is in progress. The production
default brief selects no analysis lanes, so deployed behavior changes only through the
recovery work (168), the local-time labels, and policy 3.0's output field.

- 169: `read_advisor_analysis_snapshot` (migration `20260926170000`) returns bounded,
  owner-filtered history, status events, configuration events and optional reminder
  deliveries and Notes. The database refuses undisclosed optional sources. The account
  context projects opaque records and fences the analysis revision before delivery.
  Configuration 1.3 adds `analysis` (lanes, one-tip ceiling, 7–30 day cooldown).
- 171–172: `briefing-analysis.resolver.ts` implements nine lanes with stated thresholds.
  Load compares within weekdays; periods split only at schedule, timezone or active
  changes; historical Calendar reports unavailable.
- 173: one relevant finding may become a tip, subject to cooldown and one-day spacing.
  The bubble shows the model's tip with a deterministic evidence line. Quoted or thinly
  cited Note themes are dropped. Only completed, current attempts record the content-
  free tip fingerprint (`daily_brief_tip_deliveries`).
- 170: the bubble shows travel lines projected from existing Timeline travel evidence.
  Travel stays out of model input.
- 172 Settings: reminder-history and Note disclosures with exact wording, offered when
  the server's recipe uses them or in development. Disabling Daily Brief revokes both.
- 174: 14 synthetic analysis scenarios, workbench lane controls and an analysis
  summary. Five synthetic model comparisons found and fixed a pre-existing UTC time
  defect and jargon in tips.

Verification and remaining gates: `docs/qa/briefing-workbench.md`,
`docs/qa/travel-release.md`. A port-less local Postgres container applied all three new
migrations; SQL smoke checks confirmed disclosure refusal, owner isolation, revision
matching, older-client revocation, lease-bound tip records and deletion on disable. A
full `supabase db reset` did not run. Hosted migrations, owner-clicked account
comparisons, promotion of `advisor-analysis`, deployed-web and installed-desktop
acceptance remain open.

## Ticket 168 recoverable Daily Brief loading — September 26, 2026

Implemented in source. Regression tests reproduce four loss paths against the
previous launcher (18 new cases fail there): a Timeline-keyed remount aborted the
request and the daily marker blocked another; navigation discarded the attempt;
a server-completed but undelivered result could not be retried; and web had no
client deadline while desktop lost its deadline when a signal was passed.

- The launcher now takes Timeline facts as `sourceKey` and stays mounted. A
  page-session memory per client (`lib/ui/daily-brief-session.ts`) reattaches
  remounts to the in-flight attempt or fresh result. Changed facts or expiry
  withdraw delivered text and offer an explicit refresh.
- Composed client deadlines bound preferences (15 s), the installation lock (5 s),
  session lookup, request and body decoding (75 s) on web and desktop.
- Markers record `attempted`, `delivered`, `dismissed` and a bounded `pendingUntil`
  claim for parallel tabs. Old markers count as delivered. No text is stored.
- Migration `20260926150000_daily_brief_bounded_recovery.sql` adds
  `daily_brief_runs.admissions`: one automatic start plus three deliberate retries
  per installation, day and disclosure revision, including after completion.
  The fifth returns `retry_exhausted` (HTTP 429). Quotas and records are not cleared.
- Distinct notices cover pending, rate limit (retry disabled until the wait passes),
  timeout, offline, sign-in, changed context, retry limit, interrupted, undelivered,
  expired and outdated. Server phase spans log duration and error code only.

Verification: agents, interactions, resolvers, lint (zero warnings), typecheck,
full tests (2,247 passed, 29 skipped), web build, core, design-system, desktop
typecheck and desktop build pass. A port-less local Postgres container applied both
migrations over stubs and a smoke script confirmed admission, pending, retry-after-
completion, `retry_exhausted`, owner isolation and denied table reads; a full
`supabase db reset` did not run. Bench recovery states pass at desktop and 390px on
`http://127.0.0.1:4321` without overflow. Hosted migration, deployed-web and
installed-desktop recovery remain open under Ticket 174. Evidence:
`docs/qa/in-app-daily-brief.md`.

## Advisor implementation tickets filed — September 26, 2026

Tickets 168–174 are planned; implementation has not started. The owner approved
ticketing reliable recovery, travel timing and Behavior scheduling, structured
adherence analysis, occasional actionable tips, and workbench/release evaluation.

- 168: bounded loading, delivery recovery and retry across navigation.
- 169: explicit analysis lanes and bounded, authorized evidence projection.
- 170: travel timing and Behavior fits using existing deterministic evidence.
- 171: adherence timing, schedule load and Calendar-context patterns.
- 172: recurring obstacles, reminders and decision-recording patterns.
- 173: useful prose, occasional tips and repetition suppression.
- 174: frozen-fact workbench evaluation and staged web/desktop acceptance.

`docs/TICKETS.md` records dependencies, platform impact, source paths and acceptance.
The product spec, existing briefing plan, resolver ownership and decision log record
the planned boundary. Ticket 168 can ship independently. Existing Tickets 147–148,
155, 161 and 165 retain their unverified release gates. Travel model projection and
optional private sources remain gated; no consent or runtime configuration changed.

The loading diagnosis remains based on source inspection, not a new live reproduction.
This task changes documentation only. Verification: `agents:check`,
`interactions:check`, `resolvers:check` and `git diff --check` pass. Runtime tests,
builds, provider requests and deployments were not run for this ticket-filing task.

## Security alert triage — September 26, 2026

After PR #80 merged, CodeQL rescanned `main` and reports zero open
code-scanning alerts. The one open Dependabot alert (glib 0.18.5,
GHSA-wrw7-89jp-8q8g, unsound `VariantStrIter` iterators, fixed in 0.20.0) was
dismissed with owner authorization as vulnerable code not used: glib enters
only through Tauri's Linux GTK stack, is absent from the macOS dependency
tree, Cadence ships no Linux builds, and the desktop source never uses it.
Revisit when Tauri adopts gtk-rs 0.20. Dependabot covers only npm and GitHub
Actions here, so Cargo advisories surface as alerts without pull requests. The
repository has no open security alerts of either kind.

## Public Trust code-scanning cleanup — September 26, 2026

The scheduled Public Trust evidence workflow failed on September 23, 24 and 25
because CodeQL reported six incomplete-URL-substring alerts in
`tests/travel-provider.test.ts`, where a fetch mock and its assertions matched
Google hosts with substring checks on the whole URL. The test now compares the
exact hostname through a small helper; its coverage of the workload identity
exchange, credential reuse and route headers is unchanged. The alerts close
when CodeQL rescans `main`, and the next scheduled Trust run should report the
code-scanning check as passed. No product code changed.

Verification: `tests/travel-provider.test.ts` passes; lint (zero warnings),
TypeScript and the agents check pass.

## Workbench expiry test timing — September 24, 2026

The briefing workbench DOM test that retains delivered results after snapshot
expiry mocked a comparison expiring 100 ms after delivery. The bench rejects a
response whose snapshot has already expired when it arrives, so slow CI runners
failed the test on two of three runs while local runs passed. The mocked expiry
is now one second with a matching wait. No product behavior changed.

Verification: the test file passes three consecutive local runs; lint (zero
warnings), TypeScript, agents check and the full Vitest suite (2,216 tests, 29
skips) pass.

## Ticket 166 follow-up: admitted requests finish while hidden — September 24, 2026

The shared travel hook cancels an automatic or manual request only before its
routes call. Once the routes call has started, the server may already have
admitted quota, so the request now finishes when the window blurs, hides or
unmounts; its view or failure is cached for the page session and shown on return
without a second request, and an immediate remount joins the routes call still
in flight instead of starting another. Settings and Behavior location saves
invalidate cached and in-flight travel at module level, even when no Timeline is
mounted, so requests started earlier neither share nor cache their results and
the next Timeline open requests fresh estimates; before this, a view cached
before a settings save stayed visible until it expired. Settings changes,
revoked location permission and going offline still cancel as before. This
closes the aborted-request follow-up recorded in `docs/qa/travel-release.md` on
September 23. Web and desktop share the hook; marketing is unchanged; future
mobile web inherits the behavior. No interaction, schema, provider configuration
or copy changed. Installed desktop re-acceptance remains open with the
Ticket 166 and 167 gates.

Verification: travel DOM tests (the hidden and unmount cases fail before the
change and pass after), agents, interactions, resolvers checks, lint (zero
warnings), TypeScript, desktop TypeScript, the full Vitest suite (2,219 tests, 29
skips) and the web production build pass.

## Ticket 167 base geocode reuse enabled — September 24, 2026

The Geocoding policy check is recorded in `docs/qa/travel-release.md`: Google
exempts place IDs from its caching restrictions and permits indefinite storage.
The reuse branch stores only place-ID endpoints in server memory, keyed by owner
and settings revision and bounded to 30 days and 500 entries, so
`BASE_GEOCODE_REUSE_ENABLED` is now `true`. The service tests reset reuse state
before each case and keep explicit disabled and enabled coverage. No schema,
provider configuration, interaction, dependency or user-facing copy changed.
Owner re-acceptance on web and installed desktop with Cloud Monitoring geocode
counts remains open; the next installed desktop preview inherits the change
through the hosted route.

Verification: focused travel tests, agents, interactions, resolvers checks, lint
(zero warnings), TypeScript, the full Vitest suite (2,213 tests, 29 skips) and the
web production build pass.

## Ticket 157 follow-up ledger correction — September 24, 2026

The hosted migration list confirms `20260922034223_advisor_historical_completion_times.sql`
is applied; it shipped with the Ticket 166 quota migration in PR #64. The Ticket 157
follow-up entry in `docs/TICKETS.md` no longer reports that migration as pending.
A clean local replay was attempted with CLI 2.109.1 through
`SUPABASE_CLI_BINARY_OVERRIDE`: `supabase start --network-id cadence-local`
published Postgres on all interfaces despite the loopback network, a watchdog
stopped the container within a second, and the reviewed Docker create proxy from
earlier resets no longer exists under `/private/tmp`. No migration ran locally and
no data changed. The local replay and the owner-run private comparison remain open.
Evidence: `docs/qa/briefing-workbench.md`.

## Lint warning cleanup — September 24, 2026

`npm run lint` now reports zero warnings. The seven warnings in the vendored
BehaviorLog validator snapshot are excluded through `eslint.config.mjs`
because `tests/fixtures/behaviorlog-reference/SNAPSHOT.md` pins that file by
SHA-256; the file itself is unchanged. Two unused imports in
`.agentic/scripts/check-service-operations.mjs` and one unused mock parameter
in `tests/desktop-calendar-hook.dom.test.tsx` are removed. Earlier ledger
entries that cite ten existing warnings describe the state before this change.
No product behavior, interaction or schema changed.

Verification: lint (zero warnings), TypeScript, agents, interactions and
resolvers checks pass; the full Vitest suite passes with 2,213 tests and 29 skips.

## Ticket 161 — September 22, 2026

Provider-free evaluation is implemented and verified. Thirteen synthetic scenarios
cover conflicts, transitions, supported gaps, unknown inputs and completed/empty
days. Comparison tests verify frozen facts, payload exclusions, visible failures
and recipe versions. Rollout/rollback tests preserve admission and dismissal;
desktop adapter tests retain linked-session and offline boundaries.

All required checks, core/design checks, desktop typecheck and web/desktop builds
pass. Vitest passes 2,173 tests with 29 existing skips. Lint retains ten existing
warnings. Browser checks pass at 1440px and 390px, including glossary/documents,
shared bubble and synthetic Timeline status controls. Fresh independent review
returned ship with no findings. Evidence: `docs/qa/briefing-workbench.md`.

Ticket 161 remains in progress for live model wording, owner-clicked private
comparisons, reviewed promotion, hosted and installed desktop acceptance. The
active preset is unchanged. This task ran no live generation or deployment.
Travel stays excluded from this evaluation.

## Ticket 159 — September 22, 2026

Implementation complete. The shared planner now reports deterministic conflicts,
tight transitions and individual feasible opportunities without movable selections.
Coverage, duration, freshness and move-permission controls remain enforced.
Required checks and web/desktop builds pass; 2,132 tests pass with 29 existing
skips. Lint retains ten existing warnings. Fresh independent review returned ship.
Evidence: `docs/qa/briefing-workbench.md`. Ticket 161 retains live model wording,
private comparisons and rollout acceptance. No provider generation or deployment
ran for this ticket.

## Workbench comparison inspection correction — September 22, 2026

Implementation and required checks pass. Window blur and snapshot
expiry no longer erase delivered comparisons. Focus rechecks account access and
preserves results when access is unchanged. Expired snapshots remain labeled for
inspection. Hidden-tab, navigation, configuration, mode and access invalidation
remain in place. No provider generation or private comparison was run.
All 2,105 tests pass (29 skipped), along with agents, interactions, resolvers,
design-system, lint, TypeScript and production build. Lint retains ten existing
warnings. Local workbench/static preview smoke verification passed.
Platform scope and verification evidence: `docs/qa/briefing-workbench.md`.

## Historical completion-time context — September 22, 2026

Source implementation and local workbench verification are complete. Database
verification is blocked by the installed Supabase CLI exiting with SIGKILL.
Configuration 1.2 adds independent historical completion-mark timing; existing
1.0/1.1 drafts default it off. Shared circular summaries use the history window,
current timezone and one current Completed mark per Occurrence. Unmarking removes
a sample; corrections replace it; repeated taps preserve it. Three samples across
three marking days within a three-hour circular span support a typical mark time.
Actual-finish capture and duration behavior remain unchanged.

Updated the shared types/resolver/projections, account capture, workbench,
synthetic fixtures, recipe instructions, glossary, interaction exclusion,
contracts and tests. The private snapshot migration projects existing
status_marked_at into its revision-fenced payload. Old snapshots report
source_unavailable; real-account timing needs the migration deployed.

Required checks pass: agents, interactions, resolvers, lint, TypeScript, 2,099 tests
with 29 skips, and web build. Core, design-system and desktop build pass. Lint
retains ten existing warnings. Local desktop/390px control checks pass without
overflow or a model request. Supabase db reset and type generation were attempted
but could not start. No hosted migration, private comparison or native install
ran. Concurrent travel changes are preserved. Evidence and limits:
`docs/qa/briefing-workbench.md`. Ticket 157's follow-up awaits database verification.

## Tickets 162–165 travel implementation — September 22, 2026

Ticket 165 has two installed-macOS gates left: native device location and native
navigation handoff. Installed preview.44
synced the account after the canonicalization fix; preview.45 preserved settings across
restart and completed a hosted route request (`Travel as of 9:23 AM`). Core Location on the
owner's Mac denies new clients without a prompt, including a stably signed probe app,
while already-authorized Chrome works; a machine-level new-client condition and an
Apple-trusted signing requirement (Ticket 115) both remain open until a second Mac or a
Developer ID build discriminates them. The adapter is ruled out. Tickets 166 and 167 are merged and deployed.

PR #58 merged as `b48654d1` and is deployed. The owner enabled production routing
clearance; redeploy `cadence-drxrpk40n` applied it. Hosted acceptance passed on the
owner account: workload identity exchange, v4 geocoding and one transit `ComputeRoutes`
call all returned 200 in Cloud Monitoring, and the Timeline received a return leg
with Google Maps attribution. The unlocated preceding event correctly left the
outbound leg unknown. The owner daily quota (6) is now exhausted for today, as
designed. Acceptance exposed a geocode filter defect: precise rooftop venues typed
`establishment`/`point_of_interest` were rejected as ambiguous. A coarse-type
exclusion replaces the whitelist; the stale Settings sentence is removed. Installed
macOS travel acceptance still awaits the owner's signed preview.43 build.
PR #59 (`049cbf0f`) shipped the geocode fix; production `cadence-m9a49eeqx` is Ready.
Owner web use exhausted the six-per-day owner quota within minutes because every
Timeline focus change refreshed; the client showed the generic unavailable message.
Ticket 166 covers view reuse, zero-leg admission, a 24/day owner limit, per-code
messages and in-click device-location onboarding.
Ticket 166 is implemented: the client reuses a fresh view across focus changes, the
server admits quota only before the first geocode, the quota function counts admissions
with a 24/day owner limit, failures show per-code messages, and Settings requests device
location inside the consent save with a permission state line. The hosted quota function
migration and owner re-acceptance remain.
PR #64 merged; the hosted quota function migration is applied (the pending advisor
historical completion-time snapshot migration went with it). Owner web re-acceptance
waits for the next owner local day.
Ticket 167 is implemented: travel refreshes automatically only when the page session
holds no fresh view for the current context or when the schedule, locations, corrections
or travel settings change;
focus and Calendar polls reuse the current view; the Timeline shows `Travel as of` with a
`Refresh travel` link and keeps stale estimates visible; base geocode reuse is built but
disabled pending the provider caching policy check.

Release candidate PR #58 (`codex/travel-release-2026-09-22`) now carries the full
travel implementation, the preserved-lineage Daily Brief hotfix and the briefing
workbench. On the branch: all seven required checks, 2,173 Vitest tests (29 existing
skips), web production build, desktop typecheck/build and 108 native tests pass.
Production travel environment is configured with routing clearance disabled. The PR
is not merged; merge, hosted runtime, private-account and installed-macOS acceptance
remain open.

The normal Daily Brief retry now succeeds. Isolated deployment
`dpl_6JTeeGQ7kZFdZ252AfoGMnHydu9L` contains released `362eb97e` plus the
preserved-lineage context fix and regression only. Promotion completed September
22; the existing authenticated browser retry returned HTTP 200, `state: ready`,
and displayed the briefing. No presentation/consent state was reset. The installed
preview.42 remains enabled with its default setup. The hotfix passed all required
checks (1,896 tests; 29 existing skips), production build and independent review.

Google workload identity now binds only Cadence’s exact Vercel team/project and
production subject. Its dedicated service account has Service Usage Consumer;
no key was created. Production identity configuration is saved with routing
disabled. The three travel migrations are deployed; hosted readback preserves one
reservation, leaving 39 slots. Local rollback-only SQL verifies that remaining
allowance and no day-boundary renewal. Separate v4 GeocodeAddress quotas now read
120/day and 30/minute. Hosted runtime and installed travel acceptance remain open.

The owner authorized all remaining counts and continuation after the installed
briefing failure. Hosted deployment, credential configuration and live acceptance
are now authorized within the existing US$20 routing allowance. Work resumed with
briefing diagnostics and hosted credential planning; acceptance is not yet complete.

Live setup resumed with owner authorization: existing Cadence Google Cloud
project, USA billing, a nonrenewing initial US$20 routing allowance, restricted
credentials and live testing. The existing billing account is now active;
Cadence project `habit-tracker-498717` has a US$20 custom-period budget alert.
The alert is not a spending cap; routing remains disabled until application
enforcement and release verification pass. Local advisor activation uses the
latest released source and its default configuration independently of travel.
The project Supabase binary has an invalid code signature; the installed official
2.109.1 CLI works through `SUPABASE_CLI_BINARY_OVERRIDE`. Clean local migration
replay, generated types and the SQL budget smoke now pass. Reset briefly recreated
a broad database port binding; the operator stopped it immediately and restored
loopback. No hosted migration ran.

Live public-landmark outbound/return tests now pass for all four modes. They
exposed and corrected the driving traffic timestamp. One US$0.50 reservation
covers eight geocodes and 18 route calls; the local ledger retains that slot.
The dedicated local key has API and IPv4/IPv6 restrictions; provider quotas are
120/day and 30/minute. Hosted egress, private-account and installed travel
acceptance remain open. Provider results still do not enter Daily Brief.

Cadence preview.42 from released main `362eb97e` is installed with its default
advisor. Daily Brief and Calendar timing were already enabled at account level.
The native build passed 107 tests and 11 release checks; the data backup passed
integrity checks. After Mac unlock and Keychain approval, installed verification
found the build omitted the broker address required by Calendar and Daily Brief.
The corrected preview.42 is installed and passed all 11 release checks. Installed
Settings confirms Daily Brief and selected Calendar timing enabled; Calendar
events load and account synchronization reports current data. The first automatic
briefing returned HTTP 409; successful generation remains unverified. No attempt
or dismissal state was reset. Preview.41 remains available for rollback.

Repository implementation and independent code review passed. Release acceptance
remains open. Travel stays disabled pending Ticket 165's hosted egress,
private-account and rollout gates. Initial repository acceptance used no private
location or provider requests.
The later public-landmark evidence is recorded above; hosted deployment and
installed macOS travel acceptance remain open.

Added owned Behavior locations, optional base/mode/navigation preferences, separate
routing consent, foreground browser/macOS adapters, hosted/SQLite contracts,
configuration history and profile sync. Shared travel planning handles direct
onward legs, no-base partial evidence, unknown legs, occupancy and collisions.
The server adapter bounds calls and uses persistent owner/global quotas.
First account link recognizes travel-only data and preserves private locations
through atomic account synchronization, including retries and conflict review.

The existing Timeline shows temporary travel spans, collision text, Calendar
navigation/corrections and travel inspection in located Behavior rows. Raw locations
and route evidence stay out of Daily Brief. Travel refresh preserves briefing
admission and dismissal. Updated the existing interaction registry, design catalog,
canonical disclosures, user guidance and rollback instructions.

Initial implementation verification passed 108 native tests and web/desktop
builds. After live corrections, all required repository checks and the web build
pass. Vitest passed 2,135 tests across 262 files, with 29 existing skips across
five integration files. ESLint reports ten existing warnings and no errors.
Independent review returned `ship` with no findings. The initial Supabase binary
failure blocked reset/types at that point. The authorized setup above subsequently
completed local reset and type generation. Evidence and open gates:
`docs/qa/travel-release.md`.

## Ticket 160 owner correction — September 21, 2026

Ticket 160's return-rule correction is complete. The owner withdrew the global
saved-base requirement. Missing base suppresses only the final return recommendation;
known outbound and event-to-event travel still informs advice, occupancy and
collisions. Current device position takes precedence over a predicted scheduled
origin for the next immediate departure. Tickets 162–165 remain planned and unstarted.

The nine documentation files listed below, including this ledger, now reflect the
correction. Ticket acceptance covers no-base outbound and A → B → C routing,
affected-leg recalculation, no automatic base detours, device-origin precedence
and retained known occupancy/collisions when return time is unknown.

Correction verification passes on Node 24: `agents:check`, `interactions:check`,
`resolvers:check`, lint, TypeScript, full tests and web build. The suite passes
2,037 tests with 29 existing skips; lint retains ten existing warnings. Ticket-ID
uniqueness, four-platform coverage, scoped whitespace and obsolete-rule searches
pass. This correction changes documentation only; runtime travel remains unimplemented.

The preceding discovery revision completed before this correction. The owner
replaced manual-only,
driving-only, advisor-only travel with proactive multimode routing, device-origin
precedence, optional Behavior locations, return travel and expanded Timeline
collision spans. Its global saved-base requirement is superseded by the correction
above. There is still no return-to-outbound-origin fallback.

Updated `docs/plans/travel-departure-discovery.md`, `docs/TICKETS.md`,
`docs/PRODUCT_SPEC.md`, `docs/UI_SPEC.md`, `docs/DATA_MODEL.md`,
`docs/USER_FLOWS.md`, `docs/DECISIONS.md` and
`docs/plans/first-external-consumer.md`. Tickets 162–165 are planned and unstarted:
locations/onboarding, routes/occupancy, existing UI integration, and release
acceptance. All four platform impacts are recorded. Existing interaction/design
catalogs supply implementation references; no proposed control was registered as
implemented. Provider setup, location reads, private queries and deployment did
not occur. Provider-use clearance remains required before live integration.

Verification passes on Node 24: `agents:check`, `interactions:check`,
`resolvers:check`, `design-system:check`, lint, TypeScript, full tests and web build.
The full suite passes 2,037 tests with 29 existing skips. Lint retains ten existing
warnings. The sandboxed test attempt hit a loopback fixture-server `EPERM`; the
authorized rerun passed. Synthetic complete-trip/collision boundaries, DST/midnight
and cost arithmetic pass, as do ticket-ID uniqueness, platform coverage, source
paths and scoped whitespace checks. This revises documentation only; no runtime
travel or native acceptance is claimed. Concurrent implementation changes remain
untouched by this ticket.

## Ticket 160 initial discovery checkpoint — September 21, 2026

The initial discovery completed before the owner correction above. Its deliverable is
`docs/plans/travel-departure-discovery.md`; `docs/TICKETS.md` records completion.
The brief covers origin choices, Calendar destination ambiguity, dated Google
Routes/Geocoding/Grounding Lite research, permissions, retention, costs, a contract
proposal, synthetic timing, fallbacks and all four platform impacts.

Superseded recommendation: defer implementation pending owner scope approval and provider-use
review. The proposed first slice uses explicit origins, traffic-aware driving and
deterministic advisor display. No acceptance is inferred. Implementation tickets,
saved bases, device location and model grounding remain unapproved. No provider
setup, credentials, location reads, private routing, deployment or runtime changes
occurred in this ticket.

Verification used Node 24.19.0. Synthetic timing, DST, midnight and cost arithmetic,
literal source paths, unique ticket IDs and scoped whitespace checks pass.
`resolvers:check` and lint pass; lint reports ten existing warnings. Required
checks ran against concurrent Tickets 156–158 changes: `agents:check` and
`interactions:check` report a workbench marker mismatch (65 registered, 79 in source).
Core/type checks report missing recipe/context fields and `projectBriefingContext`;
the production build fails at that missing export. The unrestricted full test run
reports 234 passing files, 11 failing files, five skipped; 1,932 tests pass,
three fail and 29 skip. Failures include briefing imports, ontology and parity.
The initial sandboxed test run also hit local fixture-server `EPERM`; the rerun
removed that environment failure. These are a dated working-tree observation,
not a clean runtime acceptance or changes owned by Ticket 160. No unrelated code
was repaired. The discovery changed only its brief, ticket entry and this ledger.

## Daily Brief recipe implementation — September 21, 2026

Tickets 156–158 are complete. Independent read-only review returned ship with no
findings and passed 115 focused tests. Configuration
1.1 binds Daily Brief recipe 1.0 and prose policy 2.0. Independent context controls
omit excluded model inputs and select duration sources explicitly. Existing 1.0 drafts
normalize safely. Finish timestamps remain unsupported. The existing workbench,
glossary and horse bubble reflect the new contract.

Parent checks pass on Node 24: agents, interactions, resolvers, core portability,
design-system catalog, lint, TypeScript, full tests and web/desktop builds. The suite
passes 2,037 tests with 29 existing skips. Lint retains ten existing warnings.
Synthetic browser controls work at 1440px and 390px without horizontal overflow.
See `docs/qa/briefing-workbench.md` for evidence and authored policy examples.

Existing worktree changes remain preserved. Ticket 159, Ticket 161 and existing
hosted/native release gates remain separate. No live model generation, private
comparison, hosted deployment or installed-desktop acceptance ran in this task.

## Daily Brief recipe tickets filed — September 21, 2026

The owner approved filing Tickets 156–161. At filing, all six were planned and unstarted:
recipe-scoped workbench/configuration, explicit context and duration controls,
Daily Brief purpose/prose, conflicts and feasible opportunities, travel/departure
discovery, and recipe evaluation/rollout. The scopes live in `docs/TICKETS.md`.

Implement 156–158 before 159, then evaluate and roll out through 161 and the
existing Ticket 155 gates. Ticket 160 is independent discovery; it authorizes
no location access, provider setup or travel implementation. Filing changes no
runtime behavior, active preset, private-comparison authority or release state.
Documentation checks pass: `npm run agents:check`, unique ticket IDs, four-platform
coverage, preservation of prior ticket content and `git diff --check`.

## Account comparison output verification — September 21, 2026

The owner clicked Run comparison with My account and Calendar context enabled.
The first observed run returned HTTP 200 with one ready briefing and one withheld
`advisor_unavailable` result. A second owner-clicked run returned two ready,
validated briefings, rendered side by side from one account snapshot.
No agent initiated either private model comparison or recorded its private text.

The exact first rejection remains unverified. Diagnosis found conflicting prompt
limits: the shared instruction hard-coded 120 words while Warm priorities permits
80 combined words. The prompt now uses the selected configuration's combined limit
exclusively. Pipeline version 1.1 identifies that prompt change. Validation,
privacy clearing, explicit-run admission and daily allowance separation remain.
All required checks and the production build pass; 2,022 tests pass and 29 skip.
Lint retains ten existing warnings. Fresh independent review returned `ship`
with no findings. Live output was verified before the prompt correction; the
corrected prompt has provider-free regression coverage. A further owner-run
comparison has not been observed. The earlier results expired normally.

## Account comparison context recovery — September 21, 2026

Owner-reported `context_incomplete` persisted after Timeline refresh. Signed-in,
owner-scoped diagnostics found stale `sync_failed` coverage. The 479-ID reminder
read now batches at 100 IDs with pagination. Settings includes archived Behaviors
in the complete configuration fence. Advisor completeness accepts preserved
occurrence lineage only after fresh synchronization. The workbench surfaces
recovery guidance; its glossary explains why Timeline refresh alone is insufficient.

The unchanged-timezone Settings action now succeeds. Readback confirms fresh
coverage. Both account context projections passed source revalidation using
one snapshot, without a model request. Temporary diagnostics were removed.
TypeScript, agents, interactions, resolvers, shared-core, design-system checks,
lint and the final production build pass. After review corrections, the full suite passes
2,021 tests, with 29 skipped. Coverage now ignores archived historical timezones
while retaining their configuration fence and counts. Due-archive recovery
directs Timeline reconciliation first. Lint retains ten existing warnings.
A fresh independent review returned `ship` with no findings and passed 93 focused tests.
The browser confirms Run comparison is enabled; generation awaits the owner's click.
See `docs/qa/briefing-workbench.md` for evidence and platform boundaries.

## Local workbench comparison origin — September 21, 2026

The owner's `access_denied` report exposed the remaining workbench origin check.
`NextRequest` normalizes `127.0.0.1` to `localhost`, so a valid browser Origin
failed before comparison input validation. The shared GET/POST guard in
`lib/services/briefing-workbench.service.ts` now reuses `authRequestUrl()`.
Same-port development loopback restrictions and production rejection remain intact.

`tests/briefing-workbench.test.ts` reproduces the failure with `NextRequest` and
checks both local hosts plus cross-host, cross-port and untrusted-origin rejection.
All 29 focused tests pass. The full suite passes 2,009 tests, with 29 skipped.
Agents, interactions, resolvers, lint and TypeScript pass; lint retains ten existing
warnings. Production build passes. Independent read-only review returned `ship`
with no findings. Live browser comparison remains owner-run and unverified.
No account data was read and no live comparison ran. Web development is affected;
desktop, marketing and future mobile are not applicable to this local guard fix.

## Local Daily Brief settings save — September 21, 2026

The owner's Settings report exposed another loopback-normalization boundary.
Daily Brief preference reads succeeded, but saves returned HTTP 401 before
storage access. `lib/services/google-calendar-request.ts` now reuses
`authRequestUrl()` for the shared Calendar/Daily Brief same-origin check.
The existing development-only, same-port loopback validation stays intact.
Production and native bearer authentication retain their existing boundaries.

`tests/google-calendar-request.test.ts` reproduces the failed local write and
checks both local hosts, cross-host/port requests, missing origins, untrusted
hosts and production rejection. All required checks pass: agents, interactions,
resolvers, lint, TypeScript, 2,004 tests (29 skipped), and the production build.
Lint retains ten existing warnings. No consent setting changed and no briefing
generation ran. Automatic approval review blocked the proposed invalid-body
browser PUT because it targets preferences; owner approval for that optional
live check remains pending. The fix is verified by regression tests.
Web local requests are affected; desktop authentication remains unchanged;
marketing has no such settings; future mobile remains deferred.

## Local sign-in and Timeline recovery — September 21, 2026

The owner authorized the diagnosed local Google sign-in fix. Supabase now
allows exact callbacks and `?next=**` variants for both loopback hostnames on
ports 4321–4330. Readback confirmed all 40 additions and preserved existing
redirects and the production Site URL. `supabase/config.toml` mirrors the local
entries; `docs/SUPABASE_WORKFLOW.md` records scope and rollback.

`authRequestUrl()` in `lib/auth/redirects.ts` restores only validated same-port
development loopback hosts. OAuth start/callback, sign-out, test-login and the
session proxy share it. Production URL handling remains unchanged.
Regression tests cover both hosts and rejection of untrusted host overrides.

The owner's retry completed sign-in but exposed a Timeline header-overflow
error. `lib/db/timeSessions.repo.ts` now batches GET presence filters at 100
IDs, retaining existing pagination, ownership filters and 2,000-ID POST RPC
batches. A 501-UUID regression failed before the fix and passes afterward.
The signed-in browser now displays Timeline without the server error.

Web local auth and hosted time-session reads are affected. Desktop's native
callback and local data store are unchanged; marketing has no sign-in; native
mobile remains deferred. No schema or interaction contract changed.
All required checks pass: agents, interactions, resolvers, lint, TypeScript,
1,996 tests (29 skipped), and the production build. Lint retains ten existing
warnings. Live redirect checks pass for both local hosts. A cancelled diagnostic
OAuth attempt verified Supabase returns to the approved local callback.
The owner completed Google sign-in; browser readback verified the signed-in
Timeline after the query fix. Application code has not been deployed.

## Workbench glossary and document access — September 21, 2026

Ticket 154 is `complete`, including the owner-requested glossary and document access.
`BriefingWorkbenchGuide.tsx` exposes 207 terms from `docs/ontology/briefing-workbench.json`,
with source symbols, related IDs, search and category filters. Preset and reference
JSON documents have previews, downloads, original source links and repository editor
access. `briefing-references.json` now holds the unchanged canonical catalog.
Contract coverage tests detect configuration, enum, error and relationship drift.

All required checks pass, including 1,983 tests (29 skipped), web and desktop builds,
shared-core and design-system checks. Lint retains ten existing warnings.
Desktop and narrow browser checks pass, including full paths at 390px.
Independent reviews found coverage and clipboard fallback defects; corrections and
regressions pass. A fresh read-only review returned `ship` with no findings.
No private account facts or live comparisons were accessed. VS Code protocol launch
remains unverified; repository file paths and downloads provide alternative access.
Ticket 155's existing release gates remain open. Evidence: `docs/qa/briefing-workbench.md`.

## My account workbench extension — September 20, 2026

Ticket 154 is `complete`, including the owner-authorized My account extension.
Both configurations share one authorized raw snapshot, with history filtering
before aggregation. `briefing-account-context.service.ts` shares briefing consent,
optional Calendar disclosure and source/session fencing with daily generation.
`briefing-workbench.service.ts` and `DailyBriefBench.tsx` keep explicit comparisons
separate from daily admission. Private results and account selections stay in memory.

All required checks pass, including 1,971 tests (29 skipped), web and desktop
builds, shared-core and design-system checks. Lint retains ten existing warnings.
Signed-out desktop and 390px browser QA passed. A fresh independent read-only review
returned `ship` with no findings. No private facts or live comparisons were accessed.
The local provider key is configured; the owner can sign in and test personally.
Ticket 155's live quality, hosted and installed-desktop gates remain open.
Evidence and changed-file ownership: `docs/qa/briefing-workbench.md`.

## Briefing workbench implementation — September 20, 2026

Tickets 151–154 are `complete`; Ticket 154's account extension is recorded above. Ticket 155 remains `in_progress` for release
acceptance; its source implementation passed independent review. Configuration,
saved presets, curated references, deterministic read-only planning and comparison
controls now share the existing daily-brief generation pipeline. The server selects
`cadence-default`: calm, 120 words, 90-day history, no references or movable Behaviors.
There are no schema changes or new dependencies.

Core ownership lives in `packages/core/src/services/briefing-config.ts`,
`briefing-references.ts` and `packages/core/src/resolvers/briefing-plan.resolver.ts`.
`lib/services/briefing-pipeline.ts` connects these contracts to the consumer,
production service and development-only comparison service. The existing
`DailyBriefBench` and shared bubble expose controls, inspectors and trusted sources.
Existing interaction/design catalogs and resolver ownership record those changes.

All required checks pass: agents, interactions, resolvers, lint, TypeScript, tests
and web build. Shared-core, design-system, desktop TypeScript and desktop build also
pass. The suite has 1,951 passing tests and 29 skipped tests; lint has ten existing
warnings. Desktop and 390px browser checks found no workbench overflow. The first
independent review found a spring-forward window bug; the second found a disabled
recap policy bypass. Both corrections and regression tests pass. A fresh read-only review returned
`ship` with no remaining source findings.

Ticket 155 source integration preserves daily admission and withdraws obsolete
configuration output. Live synthetic quality/citation review, hosted real-data and
installed linked/offline desktop acceptance remain open. No provider test or
deployment ran. Tickets 147–148 retain their release gates. See
`docs/qa/briefing-workbench.md` for evidence, platform limits and rollback.

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

## Current repository state

### Consolidated release — September 20, 2026

The owner authorized committing, merging, and deploying all outstanding changes.
The combined source passes agents, interactions, resolvers, core portability,
design-system, public-source, Trust fixtures, lint, web/desktop type checks,
1,894 JavaScript tests (29 skipped), 107 native tests, all three builds, and
marketing checks. Lint retains ten existing warnings. This supersedes the
concurrent-test/build failures recorded below for Calendar selection, marketing,
and desktop app-discovery maintenance; their separate live acceptance remains.

Production migrations through `20260921003952` are applied, including the older
pending import-memory migration `20260916195000`. Hosted readback verifies forced
RLS and no direct client access on all four advisor-private tables. The existing
approved OpenAI key is configured as a production server secret. Daily Brief
still requires account opt-in; no real account or Calendar facts were sent to
the model during this release. The unchanged migration chain retains its clean
local replay and rollback smoke evidence in `docs/qa/in-app-daily-brief.md`.
The installed Supabase CLI 2.109.1 performed deployment because the project-local
binary failed macOS signature verification. Pull-request CI and production
application/marketing deployment readback are pending at this checkpoint.
PR CodeQL flagged API-key-derived reference hashing. Daily Brief now creates a
random 32-byte reference key per generation, retaining it for freshness checks.
The regression verifies fresh keys across generations and consistent in-attempt
use. Real SQLite contracts also passed 20 tests with one skipped.
PR lifecycle review found focus-return withdrawal and pending-retry loss. The
shared launcher now revalidates account/day/settings on focus, preserves unchanged
briefings, and retains explicit retry for pending leases. DOM regressions cover
unchanged focus, changed disclosure/account/day, revoked sessions, and recovery.
Web and desktop share the fix; marketing and deferred native mobile are unaffected.
Desktop source is included; installed Daily Brief acceptance and Ticket 115
Apple-trusted distribution remain separate. Future native mobile is deferred.

Ticket 150 implementation and focused QA are finished (September 20, 2026);
repository acceptance remains in_progress because concurrent Daily Brief tests
and the web build fail. Live read-only diagnosis matched Northwestern Work's
Google ID to Cadence's `Calendar` entry. The provider now prefers summaryOverride;
the shared panel uses selected tags and an expandable searchable checkbox list.
Refresh also reloads discovery without overwriting drafts. Provider/panel tests,
governance checks, lint, initial typecheck, design-system check, desktop build,
and 1280px/390px browser QA passed. Full-suite failures and the later web-build
error belong to concurrent Daily Brief work and were not edited here.
Web and desktop share the change; marketing and native mobile are unaffected.
No deployment or live preference save occurred. Evidence: docs/qa/calendar-selection.md.

Desktop sync compatibility repair (2026-09-19): complete and installed as
preview.41. Native-model validation now rejects unknown downloaded fields before
synchronization writes and reports Update required. The current native schema
supports the hosted Behavior duration/end-date fields. Startup and manual sync
both show Account data is current; the baseline advanced and the outbox is empty.
All 1,236 prior status events remain unchanged; 22 hosted status events and one
Note change downloaded normally. All 4,801 baseline entities match SQLite at the
contract's microsecond precision. Integrity and foreign-key checks pass.
Required checks, web/desktop builds, 1,850 tests (29 skipped), 107 native tests,
20 real SQLite contracts (one skipped), copied-database migration, and all 11
preview artifact checks passed. Database backup and verified preview.40 rollback
ZIP remain in the private `Cadence Release/sync-compatibility-2026-09-19` folder.
Web already hosts the fields; no deployment or hosted schema change occurred.
Marketing has no runtime impact; future mobile remains deferred. Feature-specific
native duration/end-date UI acceptance remains separate from sync acceptance.
Evidence and changed files: `docs/qa/2026-09-19-desktop-sync-compatibility.md`.

The September 19 desktop app-discovery maintenance follow-up is in progress.
`apps/desktop/scripts/release.mjs` now prunes older unpacked preview apps after
checking retained artifact hashes and full archive equivalence. The latest
preview, compressed rollback artifacts, signatures, DMGs, and reports remain.
`tests/desktop-release-cli.test.ts` covers retention, checksum failure, retries,
and invalid keep versions; existing archive tests cover content integrity.
The initial cleanup passed all seven required repository checks. Its full suite passed 1,848 tests
with 29 skipped after rerunning outside the sandbox for loopback socket access.
Local cleanup removed 15 redundant staged apps and archived 16 private rollback
apps after restoring and comparing contents, modes, symlinks, and macOS metadata.
Spotlight excludes `.release`, native `target`, and private `Cadence Release`
storage. The installed app and tracking databases were not changed.
Final Spotlight index readback returned only `/Applications/Cadence.app`.
The owner then supplied a screenshot showing six icons. That index check did
not verify the app picker; five development/QA apps remained registered.
The follow-up archived all six generated native bundles with restoration and
metadata checks, preserving the installed app byte-for-byte. Preview staging
now removes its redundant native build copy after archive comparison. Two
subsequent Launch Services readbacks contain only `/Applications/Cadence.app`.
The actual picker could not be inspected through the computer-use bridge;
visual confirmation remains unverified, not inferred from the registry.
Follow-up agents/interactions/resolvers checks, lint, typecheck, and build pass.
All release/archive tests pass. The full suite passed 1,848 tests with 29 skipped,
but one concurrent advisor test fails: `tests/advisor-day-context.service.test.ts`
expects a context-limit error and receives an undefined `generation` TypeError.
That separate work was not edited. Repository acceptance remains in progress.
`docs/DESKTOP_RELEASE.md` records retention and recovery. Web, marketing, and
future mobile are unaffected; no product interaction changed.

Ticket 139 marketing follow-up is `in_progress` (September 19, 2026).
The owner replaced the hero Calendar disclosure with a fifth walkthrough module.
`HowItWorks.astro` uses provider-neutral connector copy and a synthetic Timeline
illustration; `index.astro` and `routes.ts` remove the old hero paragraph.
FAQ and canonical Privacy retain detailed access and disconnect disclosures.
Marketing owns this static presentation. Web and desktop behavior is unchanged;
future mobile implementation is not applicable, with narrow public QA required.
Design evidence uses `design-system.surfaces.json`; interaction intents are unchanged.
Marketing implementation and responsive QA are complete. Repository acceptance
remains `in_progress` because concurrent Daily Brief changes fail `agents:check`
(core clock injection in `advisor-day-context.ts`) and `typecheck` (Calendar
connection typing in `google-calendar.service.ts`). No unrelated code was edited.
Passing checks: marketing build/check (zero Astro diagnostics), interactions,
resolvers, design-system, lint (10 existing warnings), full tests (1,816 passed,
29 skipped), web build, and `git diff --check`. Chrome preview at
`http://127.0.0.1:4322` verifies five modules, one hero paragraph, the provider
asset, static controls, and no console errors. The new module fits 1512px,
390px, and 320px viewports. No interaction intent changed.
This follow-up does not publish or alter provider review.

Ticket 149 is `complete` in source: Calendar inspection polish and shared Timeline reload.
The owner selected overlap color `#DA3278`, thin borders, a title-aligned preview
close control, centered details, Google Calendar provider icons, and desktop
overscroll refresh with completion feedback. Required automated checks and
responsive synthetic browser QA pass. Fresh independent review returned `ship`
with no findings. Installed-native gestures and live connector reads remain
separate acceptance evidence; this task makes no deployment claim.
The duration-line follow-up also passes browser inspection and all required checks;
event duration recolors the axis with a solid 1px stroke.
Evidence: `docs/qa/calendar-inspection-refresh.md`.

Branch reconciliation on September 18, 2026 combines the outstanding product work,
18 dependency-update branches, and older legal/desktop release histories. Existing
newer implementations resolve historical conflicts; recovered desktop QA records
remain historical evidence. TypeScript 7 runs standalone and desktop type checks.
The TypeScript 6 compatibility API supports governance, ESLint, and Next.js build
checks; Astro retains TypeScript 6. Desktop declares its existing Node ambient
types, and the marketing font import names its existing CSS entry explicitly.

Local governance, source-boundary, Trust fixtures, lint, web/desktop type checks,
all three builds, and marketing checks pass. The combined test suite passed
1,792 tests with 29 skipped, including Calendar text and PR-review regressions.
PR CodeQL findings prompted a shared text-conversion fix: removed markup leaves
separators, and entity decoding runs once. A regression covers nested markup and
encoded entities; final PR checks validate the combined result. Native tests passed 106 before dependency-only
reconciliation. Lint retains ten warnings; Vite reports directive/chunk warnings.
PR review also corrected account-deletion ordering, send-time end-date eligibility
for both hosted reminder channels, and stale shared Timeline measurements. Failed
Auth deletion preserves Calendar state; external revocation follows successful
deletion. The suggested conferenceDataVersion list parameter does not apply, as
verified against Google’s read/write references in Calendar QA.
GitHub requires passing PR validation before merging into protected `main`.
Existing product-release gates and pending provider/native acceptance remain unchanged.

Tickets 144–145 are `complete` as of September 18, 2026. Both deliver
planning/documentation only. Ticket 144 has `docs/INTEGRATION_PLAYBOOK.md`, a
reusable brief, a Calendar worked example, and evidence-backed lessons.
`AGENTS.md` and `docs/OPERATIONS.md` link the playbook. Current Calendar summaries
distinguish deployed/installed proof from remaining technical and public-approval
gates. Dated checkpoints remain intact.

### In-app advisor correction — September 20, 2026

The owner corrected the external-advisor assumption. Cadence Daily Brief belongs
inside Cadence: automatic briefing text emerges from the existing horse when the
app first opens. The user can dismiss or ignore it. Behaviors, completion history
and connected Calendar facts are model inputs, not an output requiring approval.
Recommendations remain read-only; they cannot edit tracking or Calendar records.

Existing sign-in replaces external delegation. The product model is OpenAI
`gpt-5.6-luna`, behind a provider-neutral server adapter. The owner approved reuse
of the existing API key. A synthetic-only request passed using that adapter;
no real Cadence or Calendar records were sent to OpenAI.

Ticket 146 is `complete` in source. Tickets 147–148 have completed source
implementation and independent review; they remain `in_progress` only for
separate hosted/live-data/installed-desktop release acceptance. Source contains
all-status 90-day completion aggregates, current-session/disclosure fences,
bounded generation, private installation/day deduplication and web/desktop horse
bubbles. Settings defaults off and separately discloses optional Calendar timing.
The model can recommend changes but has no tracking or Calendar mutation tools.
The old GET remains disabled; the external consumer module now serves internal
generation. No prompt or briefing history is persisted.

Clean local migration replay, three rollback SQL smokes, regenerated database
types and the synthetic model call passed. SQL checks include two owners,
revoked/expired sessions, Calendar revisions, retries, deduplication and leases.
Web and desktop builds passed. Responsive fixture checks passed at 390 and 1280
pixels, including long unbroken text, 44px dismissal and accessible tracking
controls. All required repository checks passed, including 1,885 tests (29
skipped), web/desktop type checks and production builds. Lint has zero errors and
ten pre-existing warnings. Fresh independent read-only review returned `ship`
with no findings. Core portability and design-system checks also passed.

The revised plan remains `docs/plans/first-external-consumer.md`; its path is kept
for links. Evidence is in `docs/qa/in-app-daily-brief.md`. Hosted deployment,
authorized real-data/Google onward-use acceptance and installed desktop checks
remain separate. Hosted context excludes unsynced/local-only records. Offline
tracking remains available. Marketing has no new claim; native mobile is deferred.

September 19 evidence in `docs/qa/advisor-read-only.md` and
`docs/qa/advisor-auth-isolation.md` remains historical. The external-token finding
is not a first-party blocker. The earlier documentation-only review returned
`ship`; it is not acceptance of this runtime implementation.

Earlier documentation-only checkpoint: `docs/FUTURE_UPDATES.md` links both artifacts and removes the stale default-duration
deferral superseded by Tickets 142–143. No runtime, schema, provider configuration,
interaction registry, or design-system catalog changed. Revised verification
passed on Node 24: `npm run agents:check`, `npm run interactions:check`,
`npm run resolvers:check`, and `git diff --check`. Local artifact links, anchors,
code paths, and the illustrative JSON example pass validation. Fresh independent
read-only review returned `ship` with no findings. Runtime lint, type checks,
tests, and builds were not rerun because the ticket-specific verification applies
to documentation only. Calendar technical, provider-approval, and Apple-distribution
gates remain open; this work closes none of them.

Tickets 142–143 are complete in source (2026-09-17): optional default duration
and end-date automatic archive with durable in-app notifications. Web and desktop
share validation and lifecycle rules; Postgres/SQLite, synchronization, and
portability preserve the fields. Live database guards reject stale generation
plans after end-date edits. Older-bundle restore clears expired archive metadata.

Required checks and web/desktop builds passed. The full suite passed 1,786 tests;
native tests passed 106. Real SQLite contracts passed 20 tests with one skipped;
the authenticated Supabase contract, clean migration reset, and rollback SQL
lifecycle contract passed. Responsive shared-form and Timeline QA passed. Fresh
independent acceptance review returned `ship`. Evidence and changed-file summary:
`docs/qa/behavior-planning-fields.md`. Web production deployed on 2026-09-18 as
`dpl_DqLBYnrVyJQfDFV3YFcCRWicT29f`; both feature migrations are hosted.
The isolated production candidate passed all required checks, 1,745 tests,
hosted rollback SQL, public route checks, and signed-in form QA. Native release
acceptance remains pending. Older desktop clients require the native update to
synchronize Behavior changes; local tracking remains available. Unrelated
working-tree changes and the older pending import migration were preserved.


Tickets 138–140 are complete as of September 18, 2026. The replacement
verified-brand demonstration is published as Unlisted and reviewer playback passes.
Ticket 141 remains in progress. The September 20 check confirms Google verified
Calendar data access and the sensitive `calendar.events.readonly` scope.
The production broker client and the three declared scopes match the submission.
Branding remains verified. Post-approval web/native consent smoke checks remain
outstanding; public rollout gates remain unchanged.
September 23 signed-in console check: branding and data access remain verified;
no new actionable request appears. Post-approval smoke checks remain outstanding.
September 24 follow-up could not access the Identity Scaffolding Chrome session.
Today's provider status is not verified. September 23 remains the last successful
check. Open that signed-in profile to resume checks; Ticket 141 and rollout gates
remain unchanged.
September 25 follow-up: the Identity Scaffolding Chrome session remains unavailable.
Today's provider status is not verified; September 23 remains the last successful
check. The September 24 request to open that signed-in profile remains outstanding.
Ticket 141 and public rollout gates remain unchanged.
September 26 check: the owner signed the Claude browser pane into
info@identityscaffolding.com, and the Verification Center for
`cadence-calendar-498717` loaded under `authuser=1` there. Branding remains
verified and shown to users; data access remains verified; no reviewer request
appears; the three declared scopes are unchanged. Post-approval smoke checks
remain outstanding. Ticket 141 and rollout gates remain unchanged.
September 26 scheduled follow-up could not independently repeat that pane check:
the Identity Scaffolding Chrome session is unavailable, and automatic approval
review blocked broad Claude inspection. The recorded September 26 result above
is preserved; this automation obtained no new provider decision.
September 27 and 28 scheduled follow-ups: the Identity Scaffolding Chrome session remains
unavailable. Today's provider status is not verified. The recorded September 26
approval evidence remains the latest; post-approval smoke checks remain outstanding.
September 28: the owner requested disabling the Google review follow-up automation.
`cadence-google-review-follow-up` is now paused. Google approval remains recorded;
Ticket 141 still requires the one-time post-approval web/native smoke checks.
Unrelated working-tree changes were excluded from the isolated releases.

Ticket 138: Cloudflare's initially empty `cadence-me.com` zone now has two
DNS-only Vercel A records and Google's TXT challenge. DNS, TLS, HTTPS, and Search
Console ownership pass. Exact new Supabase/Calendar callbacks and canonical
URLs are configured. Every existing web/native callback and legacy alias remains.
New-domain dedicated-account sign-in, Calendar consent, selection, refresh, and
Timeline details passed. Installed dedicated-account sign-in, isolated account
replacement, refresh, two-day details, and global disconnect also pass. Fresh
legacy-broker Calendar consent completed. Native selection, refresh, and all three
demo events passed. The primary account and its existing Calendar selection are
restored; Settings reports Account data is current. All tracking IDs, counts, and
values match the private backup. One reminder advanced from pending to sent.
SQLite integrity and foreign keys pass. Immediate callback rendering was not observed.
No Cloudflare token was created.

Ticket 139: homepage, FAQ, Privacy, public links, and Google branding links are
published and verified. The owner approved the September 17 Privacy text and
recorded scope. This is owner approval, not independent legal review; the August
31 baseline approval remains. App production is
`dpl_2J1VKxrPY6gDvxVTNzFf8hpMRZ4b`; marketing production is
`dpl_8t2tdswkbtotmut2Pbs5B44uA1BE` after the verified-brand review-copy correction. All seven required commands pass in both
workspace and isolated app candidate. Candidate tests: 1,685 passed, 26 skipped;
workspace tests: 1,748 passed, 29 skipped. Marketing and narrow-layout checks pass.
Fresh review returned `ship` after correcting staged registry/environment metadata.
Public Trust origins and the running app marketing-deployment reference are
aligned after the Privacy-copy redeployment. Fresh commit-bound evidence remains
pending. No fresh Trust Passed claim was made.

Ticket 140: the owner completed Gmail setup for `cadence.testing.is@gmail.com`.
Browser readback confirms that identity. Google Calendar now contains the private
`Cadence demonstration` calendar and three harmless events: Demo planning,
Demo afternoon walk, and the September 17–18 all-day Demo workshop. No guests,
locations, or event reminders were added. Google Cloud added this identity
to the Calendar project's earlier Testing audience, preserving existing test users.
The owner completed Cadence sign-in. The dedicated account granted the two
read-only Calendar permissions. Only the demonstration calendar is selected.
Timeline displays both timed events and the two-day all-day event; timed preview
and read-only details pass. Installed desktop acceptance and primary-account
restoration passed. The private backups remain outside the repository. The final 3:35 production web demonstration shows actual Cadence branding,
both read-only Calendar permissions, selection, refresh, timed/all-day details,
and disconnect. It is Unlisted at https://youtu.be/vUi5s2B51Uo on brittlebeliefs.
YouTube checks found no issues. Complete local playback, decoding, privacy inspection,
and unauthenticated privacy-enhanced YouTube playback pass. The final labeled
client-ID reference comes from an earlier recording of the same production client;
no consent label was simulated. Installed acceptance remains separate evidence.
The earlier FFlbGp-_6bE video is superseded. A second desktop switch/restoration
matches every row in all 15 tracking tables. The primary account reports current;
the dedicated Calendar grant is disconnected.

Ticket 141: Google accepted the final questionnaire with the replacement video
and accurate recording provenance. Verification Center now reports data access
verified, observed September 20. The three declared scopes remain
OpenID, calendar-list read-only, and events read-only. No restricted/write scopes
were requested. Brand verification, the owner's Privacy approval, and technical
acceptance remain separate from Google's Calendar-access approval.
Emiliano Bache Rodriguez monitors info@identityscaffolding.com. Daily 09:00 local
Verification Center follow-up is active in this task; it notifies only on meaningful
changes or required action and does not monitor the inbox. No private correspondence
or credentials are committed. Documentation checks pass; earlier required candidate
runtime checks remain valid because this final continuation changes media/records only.

Current evidence and rollback are in `docs/VERCEL_WORKFLOW.md`,
`docs/qa/day-progress-release.md`, and `docs/qa/google-calendar-capabilities.md`.
Owner approval, technical verification, and Google's provider approval remain
separate. No schema, native package, or private provider credential changed.

Tickets 133–137 remain in progress (2026-09-17). Implementation and the reviewed
hosted rollout pass required checks. The shared Timeline, normalized external-event
contract, same-account Calendar broker, native disposable cache, and duration
estimates are integrated. Production uses the separate Calendar Google project, now In production
with Calendar data access verified; post-approval smoke checks remain. Google Cloud administration uses Identity Scaffolding Chrome;
second-account acceptance uses the owner-approved Emi Chrome profile.

Live web/native same-account connection, wrong-account rejection, selection,
refresh, preview/details/source links, disconnect cleanup, and installed offline
restart pass. Protected preview.40 is installed with 11 passing artifact checks,
a consistent database backup, and preview.39 rollback app. Its signature remains
ad hoc; Ticket 115 owns Apple-trusted distribution.

Account-switch acceptance exposed three first-link defects: Ignore could upload
concurrent local changes; category replacement inserted conflicting names before
deleting old IDs; derived native reminder changes invalidated the choice fingerprint.
The corrections enforce zero hosted writes for Ignore, compare synchronized product
entities, retain the native revision guard, and apply replacement in one atomic
transaction with safe ordering. Full-graph and rollback regressions pass; fresh
independent review returned ship. All required checks pass: 1,743 tests (29 skipped),
103 native tests, governance, lint, both TypeScript checks, web and desktop builds.
Earlier clean migrations, RLS/replay/CAS and 20 real SQLite contracts also pass.

The installed secondary account switch and Calendar isolation passed. Secondary
Calendar disconnect cleared its cache. The primary account and Calendar are restored;
account sync and Calendar refresh are current, and Timeline shows seven markers.
All primary product IDs and counts match the protected backup. Product values match
at the documented microsecond precision, excluding synchronization `updated_at`
metadata. Integrity and foreign-key checks pass. No tracking edits were submitted.

Installed future-range extension also passes. An isolated WKWebView app renders
the production shared Timeline and passes two-day all-day dismissal/restoration,
repeated-DST-hour labels, preview/details, Escape, and visible focus return.
This synthetic rendering evidence does not exercise the desktop service lifecycle.

Remaining combined acceptance includes native dense/overnight/multi-day cases, controlled
provider-failure and Workspace field evidence, and Google sensitive-scope public
verification. This September 17 checkpoint predates the production-audience
change and September 18 submission recorded above; Testing is historical. No combined
release ticket is complete. Existing unrelated working-tree changes are preserved.
See `docs/qa/day-progress-release.md` for precise evidence and remaining gates.

Full-history BehaviorLog capacity repair (2026-09-16): complete; preview.32 installed.
After the owner completed the macOS Keychain prompt, Timeline and Export & Import
opened successfully. Both preview controls show the 3 MiB limit without the original error.
Metadata now allows 8 MiB. Evidence requires a 3 MiB ZIP limit, 4.25 MiB web
request limit, 64 MiB native import preparation, compact preview ledgers, bounded
SQL action lookups/counter updates, and a 25-second account snapshot read timeout.
Web Import and Restore offer explicit native-to-browser reminder conversion.
Validation, ownership, preview binding, restore confirmations, and passive history
remain intact. The owner's private all-time copy passes previews on both platforms.
Actual writes used disposable SQLite and local Supabase databases only.
Five-year/four-Behavior roundtrips preserve 7,304 Occurrences, 6,972 status events,
1,044 Notes, 1,464 timing sessions, and all captured definition/configuration history.
All required checks pass: 1,678 default tests, 21 real SQLite contracts, 95 native
tests, real local SQL capacity and ownership/rollback contracts, and both builds.
Core, desktop TypeScript/parity, design-system checks, clean migration reset, and
type regeneration also pass. Existing lint and bundle-size warnings remain.
Preview.32 is installed with protected preview.30 and database rollback copies.
All database table hashes match before and after installation. No hosted migration,
release publication, or web deployment occurred. Platform impact: shared core and
web/desktop adapters; marketing has no runtime change; future mobile is deferred.
Files and measured capacity/remaining limits: `docs/qa/2026-09-16-behaviorlog-capacity.md`,
`docs/EXPORT_FORMATS.md`, `docs/DATA_MODEL.md`, `docs/DESKTOP_DATA_MODEL.md`,
`docs/user-guide/data-portability.md`, and the linked service/contract tests.

Desktop Export & Import mixed-history repair (2026-09-16): complete and installed.
The desktop export adapter rejected synchronized snake_case configuration history
while accepting locally authored camelCase history. Preserve stored history and
normalize only the export read, retaining shared validation. Regression coverage
checks both history formats, mixed previous/next snapshots, every download format,
and malformed data rejection. Copied-data QA also exposed the 1 MiB import-run
row limit rejecting aggregate previews. Native validation now allows import-run
rows within the existing 32 MiB import request ceiling. Ordinary row, ownership,
fingerprint, stale-preview, and destructive-restore guards remain intact.
Platform impact: desktop export adapter and native import-run validation; web keeps
its existing shared export/import/restore implementation. Marketing has no runtime
change. Future mobile remains deferred. Existing export/import interactions remain
unchanged. Files: `apps/desktop/src/local-export.service.ts`, native
`local_store/db.rs` and `local_store/tests.rs`, `tests/local-export.service.test.ts`,
and `docs/DESKTOP_DATA_MODEL.md`. No schema change or data repair was needed.
Both regressions failed before their fixes. All 1,667 default-suite tests pass
(26 skipped), as do 18 real-SQLite adapter/portability tests and 94 native tests.
Agent, interaction, resolver, core, lint, web/desktop type checks, desktop parity,
web production build, and desktop preview build pass. Existing fixture lint and
desktop chunk-size warnings remain. The initial sandbox suite could not bind
the fake email server; the authorized rerun passes.
A private SQLite backup verified every download format against the user's data.
Its 30-day BehaviorLog export passes import and restore previews. Its all-time
bundle exceeds the shared 256 KiB portability-metadata import limit; both previews
now display that validation result instead of failing to store the preview.
The full-history repair above supersedes that metadata limitation.
Older desktops need this update to synchronize import ledgers exceeding 1 MiB.
Preview.30 is installed at `/Applications/Cadence.app`; its binary matches the
verified signed candidate. Native UI confirms Export & Import renders and saves
a BehaviorLog ZIP; all 17 manifest file hashes match. Twenty-three database tables,
including all tracking data, match the protected backup. Startup changed only
account/sync, outbox, sequence, and native-reminder bookkeeping. SQLite integrity
and foreign keys pass. The previous preview.29 app and consistent database backup
remain in `~/Library/Application Support/Cadence Release/export-import-2026-09-16`.
Import/restore applies ran only against synthetic SQLite fixtures; no real tracking
data was imported or restored. Nothing was published or deployed to the web.

Ticket 130 compatible initial status marks (2026-09-16): implemented and installed.
Read-only comparison confirmed four independent initial Completed marks on each
copy. Only event identities and timestamps differ. Extend the shared planner to
retain matching initial manual marks with identical provenance and matching
occurrence projections. Choose display timestamps using existing latest-event
ordering, without using clocks to resolve different decisions. Preserve every
original event. Keep corrections, divergent history, and incompatible product
fields blocked. Remove the dormant review path that would delete losing history.
This supersedes the cross-copy rejection rule only for this narrow case.
Platform impact: desktop shared planner and INT-AUTH-009–011 conditions; web
uses unchanged atomic apply and append-only guards. Marketing has no runtime
change; existing desktop guidance documents compatibility. Future mobile stays
deferred. No schema change, sync framework, or provider migration is required.
Focused regression tests fail before the fix and pass afterward. All 74 focused
planner/adapter/engine tests and 1,647 full-suite tests pass (26 skipped).
Thirteen native SQLite sync tests pass. Agent, interaction, resolver, core,
lint, web/desktop type checks, and web/desktop builds pass. Existing lint fixture
warnings and desktop chunk-size warnings remain unchanged. Read-only architecture
review found no blocker; it confirmed preserving initial marks without inferring
causality from clocks. Preview.29 is installed at `/Applications/Cadence.app`.
The verified executable matches the release candidate. Both startup and a second
manual sync display Account data is current. All 1,196 pre-update status events
remain byte-for-byte unchanged; 12 hosted events were added. Each of the four
affected occurrences remains Completed with both original marks retained.
All three original reminder conflicts now retain hosted Sent evidence. The
updated baseline contains every event, and no outbox row remains unacknowledged.
Read-only hosted verification confirms 27 affected history/reminder rows match
the accepted baseline. Behaviors, definition/configuration history, and tracked
time remain unchanged. One account Note downloaded normally; its local copy
had not changed since the previous baseline. SQLite integrity and foreign keys
pass. The protected rollback directory is
`~/Library/Application Support/Cadence Release/compatible-marks-2026-09-16`.
No migration, admin data repair, release publication, or account relink occurred.
Native reminder coverage remains separately limited (two retained requests);
this synchronization repair does not claim to fix OS reminder capacity.
All listed release checks passed before packaging. A later final ledger check
encountered a concurrent, unrelated addition in
`packages/core/src/resolvers/day-progress.resolver.ts`: assignment to readonly
`count` fails core portability. That file is outside this repair and was not
changed here. The verified installed synchronization result remains current.

Day-progress interface closeout and infrastructure plan (2026-09-16):
The owner accepted the seventh-revision UI baseline and explicitly requested
connector infrastructure before remaining minor design polish. Ticket 132 is
complete. Tickets 133–137 now have the local implementation described above.

| Ticket | Status | Next action |
|---|---|---|
| 132: Day-progress timeline contract and layout validation | complete | Owner accepted baseline; minor visual polish deferred |
| 133: Continuous day-progress timeline on web and desktop | in_progress | Shared production layout integrated; browser checks pass; native lifecycle acceptance pending |
| 134: Google Calendar connector and documented external-event interface | in_progress | Versioned contract, OAuth broker, migration and disposable native cache implemented; local SQL isolation checks pass; Google testing client configured; hosted rollout/live consent pending |
| 135: External event lanes, previews, and details | in_progress | Shared event lanes, preview/details and Settings integrated; browser interaction checks pass; native acceptance pending |
| 136: Estimated Behavior durations and advisory overlap cues | in_progress | Persisted duration history and advisory context wired on both platforms; resolver checks pass; combined acceptance pending |
| 137: Combined timeline acceptance and release documentation | in_progress | Contract/help/privacy/registry documentation updated; local checks and fresh review pass; live/native/rollout gates remain open |

`docs/EXTERNAL_EVENT_CONTRACT.md` defines Ticket 134's required normalized
scheduling facts, versioned schemas, capabilities, coverage/errors, lifecycle,
and examples. Ticket 137 verifies the shipped interface documentation.
Wire validation, metadata, scheduling projection, server broker, Settings, and
desktop cache are implemented locally. Dynamic rearrangement and model invocation remain
deferred. MCP supplies design inspiration, not a new server or transport.

UI evidence remains in `docs/qa/day-progress-layout.md`: 1,680 tests passed
(29 skipped), required checks/build, desktop and 390px browser checks, and a
fresh ship review. Native touch/WKWebView and production connector acceptance
remain open in 133–137. `docs/qa/day-progress-release.md` tracks release gates.
No provider setup, live-account access, schema migration, or release occurred.

Planning verification: agents, interactions, resolvers, and design-system checks
passed; `git diff --check` passed. Fresh read-only review returned `ship` after
correcting stale approval gates and clarifying availability mappings/enum work.
No runtime tests were rerun for this documentation-only closeout.

Original 2026-09-15 planning updates: `docs/TICKETS.md`, `docs/FEATURE_IDEAS.md`,
`docs/PRODUCT_SPEC.md`, `docs/UI_SPEC.md`, `docs/AGENT_RESOLVERS.md`,
`docs/FUTURE_UPDATES.md`, `docs/DECISIONS.md`, and the narrow `AGENTS.md` scope
exception for planned read-only Calendar context. Existing implementation and
interaction inventory remain unchanged by this planning task. No provider
research, account access, schema migration, or deployment occurred.
Planning verification: `npm run agents:check`, `npm run interactions:check`,
and `npm run resolvers:check` pass under Node 24.19.0; `git diff --check` passes
for the planning files. No application tests/builds ran for this docs-only task.

Ticket 130 reminder-delivery reconciliation follow-up (2026-09-15): complete locally.
The owner approved automatic reconciliation of matching hosted Sent and local
Cancelled reminders from a Pending baseline. Preserve the hosted send evidence
and synchronize local occurrence decisions through the existing atomic plan.
Other reminder conflicts and conflicting user edits still require review.
Implementation: shared account-sync resolver and its paired tests. Desktop owns
the updated planner; web retains its existing hosted apply and reminder processor.
Marketing has no runtime change; desktop user guidance documents the rule.
Future mobile remains deferred. Existing INT-AUTH-009 through INT-AUTH-011
entries describe the changed synchronization and review conditions.
The regression failed before the change and passes afterward. The 72 focused
planner/adapter/engine tests pass. The full suite passes 1,645 tests (26 skipped).
Agent, interaction, resolver, core, lint, web/desktop type checks, and web/desktop
frontend builds pass. Lint retains seven existing fixture warnings; desktop build
retains its existing chunk-size warning. The initial sandbox test run blocked
five fake-provider tests from binding localhost; the authorized rerun passes.
The implementation task made no database migration, hosted data change, or
installed-app update. The owner subsequently authorized installation.
Preview.28 is now installed in `/Applications/Cadence.app` (2026-09-15).
The release helper verified the signature/seal, arm64 binary, DMG contents,
updater signature/archive, and preview Keychain marker. Installed executable
hash and Settings version match the verified candidate. No assets or feed were
published. The previous preview.27 app and a consistent database backup remain
in the owner-only `~/Library/Application Support/Cadence Release/sync-reconciliation-2026-09-15`
directory. SQLite integrity and foreign keys pass; 25 tables match the backup
exactly, including Behaviors, occurrences, Notes, status/time history, reminder
deliveries, and the sync baseline. Only account/native-reminder bookkeeping
tables changed during startup.
Installed verification exposed a separate blocker: Settings reports
"The account snapshot contains branched status history." The local copy has
four new status events since the saved baseline and no local branch. The
cross-copy history guard stops the plan before writes; the baseline remains
unchanged. Production reconciliation initially remained
unverified until the subsequent compatible-mark follow-up above repaired it. No history was
rewritten or conflict decision applied during this installation.
The broader Ticket 130 retains its separate native/hosted acceptance gates.

Desktop account footer follow-up (2026-09-14): complete locally. The desktop shell
now receives signed-in session metadata and renders the web account-name and
initials treatment. Both rail states and the narrow drawer open Settings.
Local mode retains Local profile; disconnect choices remain in Settings.
Platform impact: desktop account footer and synthetic Settings bench; web only
reuses the extracted initials helper without behavior changes. Marketing has no
account footer; future mobile implementation remains deferred. INT-SHELL-003 and
the existing navigation catalog record the platform applicability correction.
Implementation: `apps/desktop/src/desktop-app.tsx`, `account/auth.ts`, and
`product.tsx`; shared initials in `lib/ui/account.ts` and web `AppShell.tsx`.
Agent, interaction, resolver, core, design-system, lint, and web/desktop type
checks pass. Web, desktop frontend, and marketing builds/checks pass. The full
suite passes 1,632 tests (26 skipped); 54 focused tests also prove Product passes
account metadata to the shell. Lint retains seven existing fixture warnings;
the desktop build retains its existing large-chunk warning. Browser QA at desktop
and 390px widths verifies expanded/collapsed initials, Settings activation,
drawer dismissal, long-name truncation, and local-mode fallback. Fresh read-only
review returned ship without findings. Design-system mappings remain synchronized.
The owner explicitly approved signing and installation after the initial approval
review rejection. Preview.27 is now installed in `/Applications/Cadence.app`.
Local release verification passes app signature/seal, architecture, DMG equality,
and updater signature/archive checks. No release or update feed was published.
Installed WKWebView verification shows the account name and initials, opens
Settings from the footer, and preserves the initials/name tooltip when collapsed.
Settings reports signed-in account data current. Expanded navigation was restored.
SQLite integrity and foreign keys pass. Twenty-three tables match the protected
prelaunch backup exactly. Seven account-sync/reminder bookkeeping tables changed
on launch; account identity matches and only its authentication timestamp changed.
No Behavior, Occurrence, Note, status history, or time session changed.
The previous preview.26 app and a consistent database backup remain in the
owner-only `~/Library/Application Support/Cadence Release/account-footer-2026-09-14`
directory. Native accessibility initially timed out after replacement; it recovered
and the final account-row interaction checks passed.

Desktop performance loop (2026-09-14): complete. Two measured iterations remove
minute refresh polling, duplicate synchronization, idle auth Keychain polling,
hidden clock updates, and retained running audio contexts. Refresh reads coalesce;
reminder sorting reuses parsed timestamps. The 4,408-request benchmark fell from
218.82 ms to 50.74 ms. Matched fresh synthetic WebContent mean CPU fell from
1.108% to 0.045%; an 11-minute minimized run averaged 0.004%.

Reviewed and locally verified preview.26 is installed in `/Applications/Cadence.app`.
Installed WebContent mean CPU fell from 34.683% to 0.128% in two-minute samples.
Every updated app process had zero median CPU. The old process was four days old;
these samples do not prove long-term memory behavior. The old audio sleep assertion
is gone. Signed-in account synchronization and native reminder reconciliation pass.
Fifteen principal data/schema tables match their protected prelaunch backup exactly;
account-link metadata differs only in `authenticated_at`. No user history changed.
The previous app and SQLite backup remain in the protected Cadence Release folder.
No release assets or update feed were published.

All agent, interaction, resolver, core, lint, web/desktop TypeScript checks pass.
The full suite passes 1,630 tests (26 skipped). Web, desktop, marketing builds and
marketing/design-system checks pass. Final artifact verification and fresh review
pass. Lint retains seven existing fixture warnings; desktop retains its existing
large-chunk warning. Long-term memory aging, native foreground restoration,
audible chimes, and timed notification delivery remain unverified in this run.

Platform impact: desktop lifecycle, authentication, and reminders; web shares audio
cleanup and hidden time-display cleanup. Marketing and future mobile implementation
are not applicable. Existing interaction intents and design-system mappings remain;
account-sync result documentation now includes display refresh. No schema changed.
Evidence, changed files, research, and repeatable loop commands:
`docs/qa/2026-09-14-desktop-performance.md`.


Production rollout (2026-09-12): PR #52 contains the latest workspace changes.
The owner authorized production deployment. Hosted migrations `20260905020741`
and `20260908003245` are applied; all 61 migration versions now match locally.
Read-only checks confirmed Note shortcut RLS, authenticated reads, blocked direct
inserts, and blocked anonymous commits. Existing sync repairs remain installed.
The two Ready Preview deployments at `01e03993` returned HTTP 200 for the login
page and marketing homepage, with the expected Google login and Mac download CTA.
Local agent, interaction, resolver, public-source, Trust, lint, TypeScript,
web build, marketing check/build, and desktop TypeScript/build checks pass.
All 1,612 tests pass; 26 remain skipped. Lint retains seven fixture warnings.
GitHub CI and production merge/deployment verification remain pending.
Platform impact: web releases Note shortcuts, Markdown export, summary loading,
timezone fixes, and five-minute reminders; marketing releases mobile fixes.
Desktop source repairs are included, but this rollout publishes no desktop binary.
Future mobile implementation remains deferred. Existing native acceptance gates
and Ticket 091's separately authorized reminder-delivery check remain open.
Older desktop clients must update before synchronizing Note shortcut state.


Ticket 130 snapshot-timeout follow-up (2026-09-10): deployed and verified in the
installed desktop app. The broader Ticket 130 retains its separate acceptance gates.
Read-only hosted diagnostics found eight snapshot HTTP 500 responses and eight
database statement timeouts after 03:00 UTC. Auth, database, and REST health checks
passed; the activity sample had no lock waiters. Authenticated statements have
an eight-second limit. An account snapshot read took 4.8 seconds; sync apply reads
the snapshot twice. The prior processing-claim repair does not fix this timeout.

Migration `20260911031421_accelerate_account_sync_canonical_json.sql` replaces
the recursive SQL serializer with PL/pgSQL branch queries. Isolated PostgreSQL
17 tests returned identical canonical bytes and reduced synthetic serialization
from 1,018ms to 115ms, and from 818ms to 157ms with nested metadata.
`tests/sql/account-sync-canonical-smoke.sql` covers the prior serializer, fixed
key-order expectations, nulls, numbers, Unicode, escaping, nested values, and
1,500 synthetic records. Predeployment agent, interaction, resolver,
lint, TypeScript, and web build checks pass. Lint reports seven existing warnings
in the reference validator. The suite passed 1,606 tests with six timeouts during
concurrent builds; all 106 tests in those four files passed on a one-worker rerun
with unchanged time limits. No test remains failing; 26 tests remain skipped.

All 61 migrations replayed against empty local PostgreSQL 17. The normal CLI reset
recreated non-loopback bindings, so its database was stopped immediately. A second
CLI attempt refused to remove the in-use volume. The remaining migrations then
replayed through psql in an isolated loopback container using the same empty test
volume. The complete migration ledger now contains all 61 versions. Post-replay
smoke tests passed, with 1,048ms versus 192ms on the nested fixture; invoker,
immutability, authenticated execution, and anon/service-role denial all match.
Temporary test containers were stopped after verification. The local database
volume retains the replayed schema; the local Supabase stack remains stopped.

The owner approved hosted deployment in this task. A staged CLI workdir contained
the 58 deployed migrations plus only the approved serializer migration. Both the
dry run and `supabase db push` selected only `20260911031421`. The hosted ledger
and function catalog confirm deployment with unchanged execution privileges.
The same account snapshot read dropped from 4,788ms to 1,148ms. Its fingerprint
and 4,408-entity count matched before and after deployment, before retrying sync.

Installed Cadence 0.1.1-preview.24 retained the owner's two Use account version
selections. Applying them succeeded. The hosted sync receipt advanced at
2026-09-11T03:28:46Z, and six additional Mac status-history records reached the
account. The conflict panel disappeared; the desktop then displayed **Account
data is current.** No app update, account reset, or manual product-row repair
was needed. Older local-only export/Note shortcut migrations were not deployed.
The public function signatures and generated types stay unchanged.
Platform impact: web hosts the optimized helper; existing desktop RPCs use it;
marketing has no change; future mobile implementation remains deferred.

Ticket 130 processing-claim follow-up (2026-09-10): implementation and automated
checks pass locally; real database and installed-app acceptance remain pending.
The shared account-sync planner now preserves existing reminder processing claims
in ordinary and reviewed writes. Regression tests reproduced a reviewed Mac
cancellation clearing the account's claim before the repair. Both directions now
retain the claim without changing the selected status or reviving deleted rows.
The 59 focused resolver, adapter, and sync-engine tests pass. Agent, interaction,
resolver, lint, web/desktop TypeScript, and web/desktop build checks pass on Node
24.19.0. All 1,612 tests pass (26 skipped). The initial sandbox run blocked local
test sockets; the permitted rerun passed. Postgres verification could not run:
the isolated local instance at 127.0.0.1:55322 refused the connection. No hosted
or installed data changed. The repair still needs an installed desktop build
and normal synchronization acceptance; Ticket 130 remains in progress.
Platform impact: desktop uses the shared planner; web keeps its existing database
guard; marketing has no change; future mobile implementation remains deferred.
Implementation: `packages/core/src/resolvers/account-sync.resolver.ts` and
`tests/account-sync.resolver.test.ts`; review contract: `INT-AUTH-011` in
`interaction-registry.json` and `docs/DESKTOP_BUILD.md`. Notification and Ticket
130 documentation record the invariant without changing conflict policy.

Marketing mobile overflow follow-up (2026-09-10): complete locally.
`apps/marketing/src/components/HowItWorks.astro` stacks form fields and places
Occurrence actions below the title on phones. The heatmap legend wraps when its
panel cannot fit both columns. `apps/marketing/src/pages/index.astro` keeps the
mobile hero inside its lane and wraps chat example content without clipping.
No interaction intents, links, stored data, or backend behavior changed.
Platform impact: marketing homepage only; web and desktop app UI and future
mobile implementation are not applicable. The signed-in Behaviors screen was
not verified; the user's reference to that surface remains unconfirmed.
The existing marketing surface catalog remains valid.

Browser QA passed at 320, 375, 390, 430, 619, 620, 768, 820, 1024, and 1440px:
page scrollWidth equaled viewport width at each size. At 320px, every walkthrough
Occurrence row and both chat examples fit their containers without internal
horizontal overflow. Visual inspection confirmed readable titles and actions.
Required agent, interaction, resolver, design-system, lint, TypeScript, test,
web build, and marketing check/build commands passed. The test suite passed
1,610 tests (26 skipped). No production deployment occurred.

Marketing header correction (2026-09-10): the shared CTA now says **Download for Mac**.
The header wraps on narrow screens before shrinking the Cadence brand. The logo
retains its 2.15rem square size, and the mobile download target is 44px tall.
Implementation: `apps/marketing/src/data/site.ts` and `src/styles/global.css`.
The existing layout test, interaction label, design guidance, architecture, and
public user guide now match the CTA. The DMG destination stays the same.

Platform impact: marketing implements this through the shared BaseLayout and
INT-MKT-012. Web, desktop, and future mobile application UI are not applicable;
this correction changes only the public Astro header.

Verification: header geometry passed at 320, 375, 390, 430, 768, and 1440px.
The logo stayed square and never overlapped the actions. The lower-page follow-up below resolves the remaining 320px overflow. Marketing check/build, agent checks,
interaction checks, resolver checks, design-system checks, lint, and TypeScript
passed. The web build also passed. All 1,610 tests passed (26 skipped).
The initial sandbox run blocked
local test sockets and font fetching; verification reran with those permissions.
Production deployment was not performed.


Tickets 129–131 are in progress (2026-09-08). Tickets 129–130 release before 131.
Implementation preserves existing workspace changes against a captured source baseline.
Installed-data recovery and release acceptance remain pending.
The prior audit remains historical evidence: `docs/qa/2026-09-08-account-sync-audit.md`.

| Ticket | Status | Next action |
|---|---|---|
| 129: Bounded reminder bookkeeping and storage recovery | in_progress | Bound native receipts, verify protected recovery, and measure installed storage after the shared repair release |
| 130: Dependency-safe account synchronization | in_progress | Reproduce the orphan-reminder plan, repair every apply boundary, and verify normal account convergence with Ticket 129 |
| 131: Automatic downloads with user-controlled installation | in_progress | Extend the existing signed updater after the repair release; verify separate install/restart and draft protection |

Implementation evidence: `docs/qa/2026-09-08-desktop-repair-implementation.md`.
Full TypeScript tests and platform builds passed. Native interruption fixes, independent
review, isolated release replay, and installed acceptance remain pending.

Hosted migration deployment, signed release, and installed-app acceptance remain pending.

Tickets 126–128 have local implementation and verification evidence (2026-09-07).
Ticket 126's contract and synthetic evaluation passed final review. Ticket 127's
shared Note shortcuts pass automated checks and authenticated browser QA. Native
UI acceptance passed in the isolated app on 2026-09-08. Ticket 128 records a
provider no-go after 79/80 synthetic quality checks passed on 2026-09-08.
No personal Notes were uploaded. Estimated API cost was $0.0088825.

| Ticket | Status | Next action |
|---|---|---|
| 126: Recurring Note suggestions contract and model evaluation | complete | Contract and synthetic evaluation accepted; provider no-go recorded for Ticket 128 |
| 127: Behavior-scoped Note shortcuts on web and desktop | complete | Native synthetic QA passed analysis, edited acceptance, keyboard, draft-only insertion, consecutive saves, off/removal, and restart |
| 128: Bounded recurring Note pattern analysis | blocked | Live evaluation failed one negation-case recall check; retain deterministic fallback. A revised candidate needs a new measured gate |

Ticket 127 adds the shared shortcut resolver/service and Note controls, Postgres
migration `20260908003245`, SQLite schema 13, guarded Note provenance, account
synchronization, protected-backup support, and documentation/interaction evidence.
All standard checks passed: 1,573 tests, TypeScript, lint, and web build. Core,
design-system, desktop, and marketing checks/builds passed. Rust passed 76 tests;
SQLite contracts passed 18. Final local migration replay and Postgres contracts
passed through the reviewed loopback Docker proxy. All published local ports
remained on loopback after the successful replay.
Evidence and remaining QA limits: `docs/qa/2026-09-07-note-shortcuts.md`.

Earlier uncommitted export/reminder/timezone work is preserved. No hosted migration
or release occurred. Native acceptance and provider authorization remain separate gates.

Ticket 125 is complete and deployed to web production (2026-09-05).
Optional archive notes retain every archive cycle across Restore, storage,
account synchronization, and portable exports. PR #46 merged at
`d401cea83d9d71d140c20ec864763ad86101c45e`. Hosted migration
`20260906010951` is applied and congruent with the isolated release branch.
Application deployment `dpl_6E7iZpSiPGw6KVmw5fPenpvJQ9A4` and marketing
deployment `dpl_BtqTHJpfw75ZSszBv55V9noAciTc` are Ready at that commit.
The isolated release passed 1,510 tests, required CI, local replay, real
Postgres contracts, production database lint, and read-only production smoke.
Both fresh reviews returned ship. The new deployment has no error/fatal logs.
Unfinished export/reminder/timezone changes remain local. Desktop distribution
remains separate; older desktop builds must update before syncing Behavior writes.
Evidence: `docs/qa/2026-09-05-archive-notes.md`.

Tickets 123–124 are complete locally (2026-09-05). Settings supports custom categories, descriptions,
ordering, and atomic history-safe deletion. Behaviors supports category filtering,
sorting, and preserved drafts on web and desktop.

Verification: 1,499 tests, 67 native tests, 17 real SQLite contracts, the real
Postgres category contract, and two-account sync smoke passed. Typecheck, lint,
web/desktop builds, registry, resolver, design-system, and parity checks passed.
Clean local migration replay passed; generated database types match.
Browser and native interactive acceptance passed on the unlocked Mac. Category
management, filtering, draft preservation, deletion, and native restart passed.
Narrow browser layouts had no horizontal overflow. Web production rollout passed
through PR #45 at `4260b5443530949211552969820a9939aa62e432`. The hosted
migration is `20260905035835`; production deployment is
`dpl_86JK8N7oE7Pw59qmKg1XUDLuGJjo`. Desktop production distribution remains
deferred under Ticket 115. See
`docs/qa/2026-09-05-categories-and-behavior-filters.md` for evidence and files.

Ticket 088 is complete locally (2026-09-04). Behavior creation reads the current
profile timezone. Sync summaries use generation-window timezones. Existing
version and configuration guards reject stale workers; regression checks pass.

Ticket 091 is in_progress. Export opens with authenticated aggregate counts.
Explicit downloads and Markdown generation retain guardrails. Reminder cron
is configured for five minutes; the existing Pro plan supports that interval.
Migration-first hosted rollout and actual reminder timing remain unverified.

Ticket 104 is blocked on operator diagnostics and one separately approved
synthetic route test. The prior message reached a filtered folder. No filtering
rule changed. GitHub private vulnerability reporting remains enabled.

Ticket 105 is in_progress. The latest published web-push 3.6.7 retains DEP0169.
A documented upstream exception names the owner and recheck trigger. Real
package encryption passes with fake transport. Authorized Preview inspection
remains required. See `docs/qa/2026-09-04-tickets-088-091-104-105.md` for evidence.

Tickets 116–122 are complete (2026-09-02). Ticket 119 completed after the owner
selected first-hydration compatibility handling for existing same-status
branched hosted history and installed preview.19 hydrated the owner account.
Hosted migrations are deployed and congruent through `20260902052213`.
Hosted account-sync smoke passed, and hosted RLS passed 92 checks. The final
QA A and QA B binary hashes are
`051b963faf26e262dba241e8e96a21b8304c94d165d5d3719514830ee5c9873c`
and `317ff0a011d0e92ad56e9b270e52ca1fcc214e008eea6d84b7bdf0c7bfb4d598`.
The hydration revision fix passed native QA. A later status-sync failure exposed
Occurrence configuration-lineage clearing as the next root cause. Migration
`20260901200000` added the initial broad guard; scoped correction
`20260901203000` preserves unchanged lineage only for account-sync scheduling
fields. Native status transition then converged, and branched status history was
rejected before review.

The installed two-copy conflict and disconnect matrix now passes the verified
paths. Concurrent Behavior conflicts showed the shell cue and panel. A stale
decision was rejected. Both Mac and account decisions applied, while Keep both
remained unavailable. The final two-copy baseline is
`6911d097b519e00f1f05487aaefda5d36ccb630c3d078178dd7a5d4586c7037b`
with zero pending changes. Keep-local disconnect removed Keychain, link, and
baseline state while preserving the complete local working copy. Local-mode
Restore from `/private/tmp/cadence-ticket122-qa-b-pre-conflict.sqlite3` passed
and protected the prior database at the app's owner-only Backups location.
Remove account data created the mode-600 backup
the app's owner-only Backups location,
created a fresh profile and default categories, removed product/link/baseline
state, and removed the Keychain session. Published preview.3 remains unchanged.
Preview.7 built and passed review but is superseded by later migration, test,
and documentation changes. Native first-link Ignore and Import now pass. Ignore
kept the hosted copy and protected the discarded local copy. Import preserved
both the local and hosted Behaviors and converged with zero pending changes.
Preview.8 and preview.9 are superseded local-only candidates. Neither was
published or installed. The post-classifier completion matrix passes: 1,463
Vitest tests passed, 23 skipped, all 59 native tests passed, and every required
check and build passed with only the existing lint and chunk-size warnings. A
fresh `Cadence QA Revoked` app uses bundle ID
`app.cadence.desktop.qa-revoked`; strict deep code-sign verification passed,
the corrected classifier is embedded, and its executable SHA-256 is
`7a28021b858cbc37702d0655bdf1e4fa70b7cf7a4ec917c051ff7ee988081d60`.
The unique native revoked-session path now passes. Cadence showed, “The account
session expired or was revoked. Reconnect or disconnect the account.” Sync now
preserved that state, baseline `ccbb6584…`, pending local mutations, and hosted
counts. Keep a local copy then disconnected the account, retained two Behaviors
and 64 Occurrences with integrity `ok` and zero foreign-key violations, cleared
link and baseline rows, and removed the isolated Keychain item. Tickets 119–122
were still in progress at that checkpoint. Preview.10 is published,
installed-defective, superseded,
and retained. Installed acceptance exposed missing public Supabase
configuration. Its three remote assets remain immutable. Preview.11 must pass
the new release preflight and corrected updater acceptance before the final feed
moves forward. Preview.11 is local-only, superseded, unpublished, and retained:
Vite omitted both public values because the source read `import.meta.env`
dynamically as a whole object. Preview.12 is local-only, superseded,
unpublished, and retained. Its release orchestration lost both reviewed public
values at Tauri's nested frontend-build boundary. Release tooling now owns that
frontend build and rejects fresh frontend output missing either public marker.
Preview.13 failed during configuration-only local verification because its raw
staged-app scan could not inspect Tauri-compressed assets. It produced no
immutable bundle. The guard now checks fresh frontend output before Tauri runs;
native configured-state acceptance was the packaging/runtime gate.
Preview.14 completed final release acceptance. Its explicit frontend build
and exact fresh-output public-marker guard passed before Tauri ran with the
nested `beforeBuildCommand` disabled. Archive, signature, DMG, application
parity, updater signature, feed fixtures, and secret scans passed. Its three
immutable assets were published to the existing prerelease. The invalid-
signature, unavailable-download, and final-valid updater stages passed with
remote readback. The real updater installed and restarted preview.14, migrated
schema 9 to 10, preserved stable identity and owner data, exposed configured
Google sign-in, and passed postinstall integrity and secret acceptance. The
final feed SHA-256 is
`98cd47d6c3cda522331474f370ba3a00089f931eb48b4e8cb806c0c2e860b649`.
The release remains prerelease and not latest. Hosted fixture user
`92402e46-1abb-46b0-b957-337fda7b8990`, its owned rows, and the exact QA-A and
QA-B legacy Keychain items were removed and verified absent. Tickets 119–122
completed their controlled acceptance matrix.
Preview.15 supersedes preview.14. The installed preview.14 failed Google sign-in
because its ad hoc signature has no Keychain access-group entitlement while the
binary selected the Data Protection Keychain path. Preview builds now select
the existing legacy login-Keychain path and verify its compiled marker; Apple-
signed production builds remain unchanged. Preview.15 passed artifact checks,
installed, completed Google PKCE with the owner's account, and became the final-
valid updater feed. Its archive, signature, and DMG passed independent remote
hash readback. The GitHub release remains prerelease and not latest. At that
checkpoint, the production marketing site linked directly to the preview.15 DMG.

The owner account first stopped safely before hydration because its hosted
snapshot contains pre-existing same-status branch history. The owner chose
compatibility handling. Preview.16 through
preview.18 remained unpublished local-only diagnostics: retry gating, status-
revision order, and import-run order failed in sequence. Preview.19 applies
both history dependency chains before their children. Installed hydration then
saved one baseline, cleared the pending attempt, reached Account data is
current, and retained the complete owner-scoped account snapshot unchanged.
SQLite integrity and foreign-key checks passed. The release assets and final feed passed remote
hash readback. The release remains prerelease and not latest. Production
marketing deployment `dpl_Euzkkoi8VZraWNJ37y5bAvUXk8Wo` links to the
preview.19 DMG.
The final pre-commit review closed additional safety gaps. Hosted account-sync
apply now serializes each account, locks cross-account entity identities before
ownership checks, and stores bounded receipt metadata. The new migration
`20260902052213_serialize_and_bound_account_sync_apply.sql` is deployed. The
expanded hosted account-sync smoke passed same-account and cross-account races,
bounded receipt replay, and cleanup. Hosted RLS passed all 92 checks. Native
restore, disconnect, schema validation, dependency ordering, and collection
limits passed 65 Rust tests. Desktop authentication now preserves linked state
during reconnect, and first-link reconciliation applies the reviewed planner.
Ticket 119 has exact untouched-seed detection,
the explicit responsive import/ignore/cancel choice, incomplete-link cleanup,
and a validated owner-only protected-backup command that returns its exact path.
The authenticated desktop adapter now reads complete RLS-scoped hosted rows,
imports through the existing atomic BehaviorLog RPC, hydrates through one local
restore-plan apply, and records schema-8 common-baseline state only after both
commits. Deterministic attempt identities support retry; conflicts write neither
copy. The final post-classifier matrix passed 1,463 Vitest tests with 23 skipped,
all 59 native tests, and every required check and build. The isolated native bundle exposed all three
choices and completed cancel. The corrected Ignore case converged on fingerprint
`6911d097b519e00f1f05487aaefda5d36ccb630c3d078178dd7a5d4586c7037b`,
kept only `Matrix account winner` live, protected `Ignore me local`, left zero
pending changes, and did not change hosted data. After a fresh Remove, Import
kept `Import me local` and `Matrix account winner`, saved baseline prefix
`ccbb658424a3`, and left zero pending changes. See
`docs/qa/2026-09-01-desktop-first-account-link.md`.
Ticket 117 implements the exact Application Support database path, native
Finder reveal, consistent online backup, and protected local-only restore.
Native Finder reveal, backup, protected restore, database validation, quit,
and restart passed against the built app. The live and protected databases
passed integrity, foreign-key, schema 6, and owner-only permission checks.
Evidence: `docs/qa/2026-08-31-desktop-local-database-controls.md` and
`docs/qa/2026-08-31-desktop-authentication.md`.

Tickets 116–122 add app-managed local database
controls, optional desktop Google sign-in, an explicit first-link data choice,
offline-capable two-way synchronization, conflict review, disconnect choices,
and real-updater migration acceptance. Ticket 116 aligned the synchronized and
device-local field boundary, RLS/SQLite ownership, snapshot ceilings, pure merge
planner, idempotent two-commit retry, and first-link/conflict ownership across
the source-of-truth documents. It made no runtime, schema, provider, hosted, or
marketing change. Checks passed: agents, interactions, resolvers, and diff.
Ticket 118 added local authentication runtime with the official Tauri deep-link
plugin, query state, fixed Keychain slots, and nonsecret SQLite link metadata.
The owner-approved temporary legacy-Keychain QA app completed Google PKCE,
native callback delivery, exact-once token exchange, restart persistence, and
replay rejection. Production Data Protection Keychain acceptance remains with
Apple-signed release work under Tickets 115/122. The complete account-sync
migration chain through `20260902052213` is hosted and congruent. Ticket 122
accepted preview.19, and marketing links directly to its disclosed unnotarized
DMG. Installed preview.10 is
superseded because its bundle omitted public Supabase configuration. Release
preflight now requires the HTTPS desktop Supabase URL and a public publishable
or legacy anon key before building another account-sync preview.
Account-free local mode remains complete. Ticket 115 remains independently
deferred and its Apple-trust gates are unchanged.

Ticket 113 is complete and Ticket 115 is deferred (2026-08-31). The owner
rescoped Ticket 113 to the unnotarized Apple Silicon preview and updater-
acceptance milestone. Apple-trusted distribution now belongs to Ticket 115.
The approved eleven-asset `desktop-preview` prerelease is public at release ID
`380047141`, targeting existing remote commit
`02a69374122f6492e5fb6414e76a9fb34b040aef`. No source push ran. GitHub asset
digests match the approved packet, and the valid `.2` feed is public. Safari
download quarantine, macOS per-app approval, three expected failure paths, the
valid `.1` to `.2` installation, separate restart, and current-version check
passed. The updater interaction is implemented. Ticket 113 does not claim
Developer ID signing, notarization, or macOS 14 compatibility.

The strict production check loaded the existing public endpoint, canonical
public key, persistent updater key path, and Keychain-held password without
printing or regenerating secrets. Updater configuration, tools, and all 64
desktop interactions passed. It stopped only on the unavailable Developer ID
Application identity and complete Apple notarization credentials. Ticket 115 is
deferred because the owner also lacks an Apple Silicon Mac running macOS 14.

Both tested previews use SQLite schema 6. Live shipped-migration testing is not
applicable to Ticket 113. Existing native rollback tests remain current evidence.
The first future schema-changing desktop update must upgrade an older installed
version through the real updater after a protected database backup.

Ticket 113 preview preparation passed (2026-08-31). Two Apple Silicon candidates,
`0.1.1-preview.1` and `.2`, passed sealed ad hoc signing, hardened runtime,
arm64/minimum-OS checks, DMG verification, persistent-key signature verification,
and full archive comparison. Candidate builds no longer require final updater
acceptance first; production readiness and Apple artifact checks remain strict.
The encrypted updater key stays outside the repository; its password is in login
Keychain. The six exact asset authorizations are recorded without relicensing.

Preview `.1` installed from its local verified DMG to `/Applications/Cadence.app`
and launched with the expected version. The database backup and post-install
comparison preserved profile, Behaviors, Notes, history, provenance, and reminder
delivery evidence. Only routine reminder verification timestamps/coverage and
appended outbox entries changed. Integrity and foreign-key checks passed.
The unpublished-feed check failed safely with its retry control available.
This does not count as downloaded installation or live updater acceptance.

The concrete public-hosting packet is
`apps/desktop/.release/preview/hosting/APPROVAL.md`. It lists eleven assets,
five controlled feed stages, and the dedicated `desktop-preview` prerelease in
`emixd12/habit-tracking-app`. It discloses uncommitted build inputs and the
baseline tag/source-archive mismatch. The owner approved it and the corrected
remote tag target. Publication and controlled feed testing passed. Apple Program
access, Developer ID, notarization, quarantined notarized-DMG Gatekeeper testing,
and macOS 14 execution moved to deferred Ticket 115.

Checks passed: agents, interactions, resolvers, core, design system, lint,
web/desktop TypeScript, web build, and both native preview builds. The full suite
passed 1,374 tests with 17 skips; 41 Rust tests and 15 real SQLite contracts passed.
Both real preview archives passed tamper and invalid-signature rejection through
the release verifier. Independent tooling/packet review passed. Seven existing
lint warnings and the desktop chunk-size warning remain. Evidence and key handoff:
`docs/qa/2026-08-31-desktop-preview.md` and `docs/DESKTOP_RELEASE.md`.

Ticket 113 preview milestone started (2026-08-31). The owner authorized an
Apple Silicon preview with ad hoc signing, without Apple credentials or
notarization. Apple enrollment, Developer ID signing, notarization, and original
signed-release acceptance are explicitly deferred, not passed. Preserve Cadence,
`app.cadence.desktop`, existing local data, and declared macOS 14 minimum;
compatibility is verified only on tested systems. Candidate construction will
no longer require the final updater interaction to have already passed.
Production release-readiness checks remain strict. The owner also authorized
one persistent protected updater key pair after checking for an existing key,
and distribution of the six exact Cadence image/audio assets. Their MIT
exclusions, trademark reservations, and third-party notices remain unchanged.
Prepare two preview versions and a dedicated prerelease feed in the existing
`emixd12/habit-tracking-app` repository. Public artifacts, releases, and feed
exposure require approval of the concrete files and destination. No publishing,
key generation, or preview build had occurred at that starting checkpoint.

Persistent updater key preparation passed (2026-08-31). One encrypted pair now
exists outside the repository with owner-only access. Its generated password is
retained in login Keychain. Real Tauri signing and Minisign verification passed;
an empty password failed. Public fingerprint and secure backup instructions are
in `docs/DESKTOP_RELEASE.md#persistent-updater-key-handoff`. GitHub authentication
and the existing public repository were verified read-only. Nothing was published.
Candidate tooling and two preview builds subsequently passed as recorded above.

Offline launch and persistence passed (2026-08-31). The owner confirmed the
disconnected-network test and supplied the Completed screenshot. A read-only
SQLite snapshot confirmed the status mutation at 00:26:04 EDT. The running app
started at 00:26:20, after that write, and displayed Completed. Network
disconnection is owner-confirmed; saved status and relaunch were independently
verified. The native UI archived the synthetic Behavior without changing its
Completed history. Settings verified zero pending/eligible reminders; integrity
and foreign-key checks passed. Tickets 107–112 and 114 are complete locally.
Ticket 113 later completed its preview milestone; Apple-trusted distribution
moved to deferred Ticket 115.
Evidence: `docs/qa/2026-08-30-desktop-lifecycle-release.md#offline-launch-and-persistence-passed`.

System sleep/wake passed (2026-08-31): macOS logged Software Sleep at 00:17:30
EDT and Wake at 00:17:32. Cadence reconciled reminders during wake and committed
coverage at 00:17:35, before its next minute poll. A read-only SQLite snapshot
captured automatic renewal before any GUI inspection. Settings showed Allowed,
complete coverage, zero pending/eligible reminders, and no error. Integrity and
foreign-key checks passed. Ticket 112 is complete locally; its tracking
implementation dependency is fulfilled. Ticket 111's subsequent offline launch
and persistence acceptance also passed. Apple release gates later moved to
Ticket 115. Runtime code
and the verified app/DMG are unchanged. Evidence:
`docs/qa/2026-08-30-desktop-lifecycle-release.md#system-sleep-and-wake-passed`.

Offline cleanup is complete: `Cadence offline QA` is archived with its Completed
2026-08-31 Occurrence preserved. Native reminders stayed disabled. The private
baseline and backup are under `/private/tmp/cadence-native-qa/offline-before.*`;
the verified result and cleanup are in `offline-after-owner.json` and
`offline-cleanup.json`. Cadence remains open in Settings. No active synthetic
Behavior or active native reminder intent remains.

Native product click passed (2026-08-30): the owner clicked the 22:41
`Cadence lifecycle QA` notification after the app fully quit. Computer Use
confirmed Cadence already running before inspection. Timeline expanded and
focused the exact target `2688533a-7c7d-4450-9e2f-8ad640022a33`; the earlier
22:30 row stayed collapsed. Tab moved focus to that target's Track Time.
The UI then archived the synthetic Behavior. Settings confirmed zero pending
and zero eligible reminders at 22:48:33. The registry now marks native
notification activation implemented. System sleep/wake and offline launch
subsequently passed. Evidence:
`docs/qa/2026-08-30-desktop-lifecycle-release.md#product-notification-click-passed`.

Delivery-history correction verified: the same native click exposed an
export defect. macOS removed the clicked notification from delivered readback;
expiry cleanup then stored `cancelled`, which canonical export repeated despite
the observed click. The bounded fix preserves exact OS delivery evidence before
cleanup without claiming user receipt or reading. Callback and readback proofs
survive failed writes and settlement races. The fix passes 1,364 tests with
17 environment-gated skips, 41 Rust tests, and 15 real SQLite contracts.
Repository checks, TypeScript, lint, and web/desktop builds pass. No schema changed.
The corrected app recorded the real 23:10 EDT macOS delivery automatically.
The record survived archival and a full restart. Native BehaviorLog export kept
`delivered` with user receipt unverified and passed the pinned reference validator.
The old callback already drained by the preceding build was not reconstructed.

Acceptance continuation (2026-08-30): Tickets 111–113 resumed for native
lifecycle proof, real updater-signature checks with disposable test keys, and
asset provenance review. The earlier completed tickets remain complete. No
hosted rollout, publication, or production credential changes are authorized.

The lifecycle audit fixed the missing precise profile-local midnight refresh.
Product tests verify Needs decision regrouping, reminder repair, DST, timezone
replacement, cleanup, and existing wake/resume event handling. Real Minisign
tests now exercise the release command's verifier and reject altered archives,
keys, signatures, trusted comments, and malformed envelopes. Private fixture
keys stay in memory. The delivery-history continuation above records the latest
test counts. Repository checks, TypeScript, lint, and web/desktop builds pass.
Six image/audio permissions lacked evidence at that checkpoint; the owner authorized their distribution on 2026-08-31. Details and remaining native
gates: `docs/qa/2026-08-30-desktop-lifecycle-release.md`.

The updated ad hoc app/DMG passed strict signature, arm64/minimum-OS, and
read-only DMG manifest checks at 23:07 EDT. Native launch and Settings passed;
zero pending reminders remain after synthetic archive cleanup. The earlier
owner-assisted product notification click/focus passed. After the delivery fix,
the app remained open in Settings for the subsequent passing sleep/wake check.
Offline launch and persistence subsequently passed in the owner-assisted check.

Desktop continuation (2026-08-30): Tickets 109, 110, and 114 are complete
locally. Ticket 112 subsequently completed its native lifecycle checks.
Ticket 111 subsequently completed disconnected-network acceptance.
Ticket 113 was blocked at that checkpoint. Its 2026-08-31 preview milestone now
defers Apple credentials and final signed-release acceptance; asset authorization
is recorded and persistent updater key preparation passed.

Integrated acceptance fixed canonical passive Intervention storage, repeated
configuration-history export, exact passive Note/Intervention matching, and
current-versus-imported schedule identity. Accepted source fingerprints permit
safe older-bundle replay only while the owned current schedule and phase match.
Unknown legacy source dates remain conflicts rather than inferred history.

Final verification: 1,336 Vitest tests passed with 16 environment-gated skips;
all 14 real SQLite contracts and the ordinary-client Supabase contract passed
separately. Forty Rust tests and formatting passed. Repository, interaction,
resolver, core, and design-system checks passed, as did lint, web/desktop
TypeScript, web/marketing builds, and native app/DMG packaging. The desktop
release gate rejected only the then-planned signed-updater interaction after
the subsequent native click/focus proof. The public preview later completed it.

The local clean reset applied all 47 migrations through `20260831014424`.
Both corrective 0.3 migrations passed real SQL execution. The 92-check RLS
smoke passed, generated database types matched, and exact cleanup removed all
synthetic accounts and product data. No hosted migration or deployment ran.

The actual app upgraded its existing SQLite database from schema 5 to schema 6.
All 20 domain tables matched the pre-launch backup. Integrity and foreign-key
checks passed. Actual WKWebView export produced valid 0.3 archives with privacy
defaults and explicit Note/time inclusion. The pinned reference validator passed.
The native self-import preview exposed the passive Note identity defect before
Apply; no duplicate domain record was written during that preview.

The standard and Cadence share the Configuration History Profile, explicit
calendar semantics, and a byte-exact schema/validator snapshot. The applied-import
ledger preserves validated configuration history, source Occurrence timezone
and lineage, category registries, and accepted schedule identity. Unsupported
required extensions block apply; omitted optional fields produce loss warnings.
Imported history never invents local capture or replays notifications.
Full arbitrary-extension lossless exchange is not claimed.

Current acceptance evidence and remaining native/release gates live in
`docs/qa/2026-08-30-desktop-0.3-acceptance.md`. Earlier 0.2 test counts and artifacts
are historical checkpoints. Seven existing vendored-validator lint warnings
remain. Developer ID signing and notarization remain unavailable. The public
preview later proved signed updates, and the owner authorized the exact assets.

Platform scope: web and desktop share portable contracts; marketing has no new
interaction; future mobile inherits those contracts without implementation.

The numbered implementation sequence is complete through Ticket 065. Ticket
066 continues the Locust infrastructure stress-testing roadmap with an
approval-gated hosted capacity run. Ticket 067 is `blocked`; its local
launch cost guardrails and traffic-surge operations are implemented, while its
owner-policy and provider acceptance gates remain unresolved. It adds no product
billing or an admin dashboard. Tickets 068, 069, and 070 are complete. Ticket
070 adds privacy-gated time-tracking exports after the Timeline
stopwatch capture/reset and compact Behaviors timing context. Ticket 068 may
proceed locally without the provider gates blocking Tickets 066-067; Ticket 070
follows Ticket 069 so export aggregation reuses the settled Behaviors semantics.
Ticket
063's local-only harness, registry-derived workload manifest, authenticated
protocol proof, and exact disposable-account cleanup are implemented and
verified. Ticket 064's independent synthetic identities, realistic read
cohorts, bounded local baseline/ramp/recovery, integrity gates, and exact
cleanup are also implemented and verified. The only
human-gated interaction-audit item at this frontier is IA-024, which needs a
product decision before onboarding dismissal can change from origin-global
browser storage to account-specific storage. Broader workspace restructuring,
mobile, web PWA/offline, billing, and AI/speech work remain deferred or
unticketed. Tickets 107–114 implement the local-first macOS desktop track;
Ticket 115 defers Apple-trusted distribution.

Ticket 071 is complete. Mobile Timeline now supports a guarded pull-to-refresh,
one confirmed transition to Completed makes one completion-chime playback
attempt, and expanded resolved labels remain parallel to the behavior title.
The owner explicitly approved adding the source screenshots to the repository
on 2026-08-04. Chromium touch QA passed. Mobile WebKit and an authenticated
physical-device pass remain unverified because those browser surfaces were not
available in this environment.

Tickets 078 and 095-097 are `complete` locally under explicit owner direction
on 2026-08-14. Ticket 078 prevents Behavior edits from deleting unresolved
Occurrences at or before the current instant or future unresolved Occurrences
with notes or tracked time. Tickets 095-097 add append-only Behavior
configuration history, Occurrence-to-revision lineage, and rich-export schedule
history without adding medication dose or clinical semantics. Clean migration
reset, authenticated RLS smoke coverage, real 1,001-row Data API pagination,
949 tests passed with one environment-gated integration test skipped. Lint,
typecheck, build, and repository checks passed. Hosted migration deployment
remains unauthorized and was not performed.

Tickets 072-074, 077, 079-084, 086, 092, and 093 are `complete`.
Tickets 072-074, 077, 079-084, 086, and 093 are deployed. Tickets 085, 087,
089, 090, and 088 are `complete` locally; Ticket 091 is `in_progress`.
Ticket 092 is complete locally without a provider
mutation. Ticket 094 is `complete`. Tickets 078-093
were defined on 2026-08-06 from a repository-wide read-only audit across five
independent passes (domain resolvers/services/repos, routes/auth/API,
import/restore/export, UI/interaction, schema/marketing/ops). No fix was applied
during the audit and no product scope changed. Scope and acceptance criteria
live in `docs/TICKETS.md`; Ticket 091 awaits hosted rollout acceptance.

Tickets 085, 087, 089, and 090 completed locally on 2026-08-27. Ticket 085
adds range-aware Occurrence identity, missing-overlap backfill, idempotent
generation and import lookup, and generated database types. Ticket 087 adds
Behavior, status, Note, and read-cache concurrency guards. Ticket 089 preserves
Note drafts, invalidates stale import previews, keeps Stop available after
midnight, makes completion audio non-blocking, and excludes modal gestures from
Timeline refresh. Ticket 090 fixes dialog focus containment, Behavior recurrence
errors, and explicit profile-timezone timestamp formatting. Clean database
reset, migration rerun, schedule-integrity smoke, database lint, 1,101 tests,
an explicit populated pre-migration backfill proof, agent and interaction
checks, lint, typecheck, design-system checks, and the production build passed.
One environment-gated test skipped. Lint retained
eight pre-existing fixture warnings, and database lint retained four
pre-existing BehaviorLog warnings. Authenticated production hydration and
physical 390px touch QA remain unverified because those browser surfaces were
not available. Hosted migrations were not pushed.
Ticket 094 was added on 2026-08-12 after the live 90-day Behaviors range
produced an oversized Supabase Data API URL. It replaces Ticket 091's earlier
chunked-table-query decision with two owner-scoped query contracts: a bounded
arbitrary-ID RPC with automatic batching, and a joined date-range/keyset-cursor
RPC for historical Analytics and Export reads. Local implementation and
verification completed on 2026-08-12. The owner authorized and completed the
migration-first hosted rollout on 2026-08-12. Authenticated production QA
passed for every required caller, so the production defect is resolved.

Ticket 082 caps one account at 20 active push subscriptions through an
owner-serialized database trigger. The 21st registration keeps the new row and
evicts the LRU row. Reminder fan-out reads at most 20 rows and uses four
concurrent workers. A distributed authenticated-account limiter allows six
registration attempts per 60 seconds without resetting the separate auth-
failure limiter. Sign out discovers existing browser PushManager endpoints and
deactivates the departing account's current-device row before local session
clear. A clean migration reset, generated-type comparison, focused 74-test
suite, local 21st-row/concurrency/two-account smoke, 991-test full suite with
one environment-gated skip, lint, typecheck, build, repository checks, and diff
check passed. The first sandboxed full-test run failed only because the existing
fake provider could not bind loopback; the permission-enabled rerun passed. No
hosted migration, application deployment, provider contact, or push send was
performed. Two intermediate reset attempts applied every migration but received
a local gateway 502 during container restart. A non-destructive local
Supabase stop/start restored health; the final clean reset and smoke passed.

Ticket 083 makes both destructive Settings writes preserve a recoverable
boundary. Account deletion validates both gates, verifies the service-role
client, hard-deletes the Auth user, then attempts global sign-out. Verification
or deletion failure leaves the account and session intact. A post-delete
sign-out error does not turn completed deletion into a false retry state.
Settings timezone save reuses the Ticket 095-097 history-aware transaction.
Migration `20260825075255_fix_settings_timezone_conflict_errors.sql` changes
its stale preconditions from retryable `40001` to non-retryable `P0001` without
weakening configuration history. Authenticated local smoke proves rollback
after the profile update, one configuration event, and one sync-state version
increment. Clean reset, 1,000 tests with one environment-gated skip, lint,
typecheck, build, repository checks, and local advisors pass. No hosted action
occurred.

Ticket 098 is `complete` with release decision `PASS`. Ticket 099 is
`complete` locally. The repository owner monitors the security inbox. The
sender accepted and retained exactly one authorized synthetic route-test
message with sent status, and recipient-side inspection confirmed receipt at
the approved mailbox. The message landed in the junk folder, so monitoring
filtered folders or maintaining appropriate allowlisting remains required.
Ticket 100 is `complete`. It published the reviewed repository, protected
`main`, enabled the required security controls, triaged the first scans, and
completed the production checks. PR #13 merged the final completion evidence
through protected `main`. Tickets 098-100 define the public repository security
gate, open-source license and private disclosure contract, and authorized
GitHub publication sequence. Tickets 079-083 and 093 are deployed and verified.
The authorized private `main` history rewrite is complete.

Tickets 101-103 are `complete`; Ticket 104 is `blocked` and Ticket 105 is
`in_progress`. Tickets
101-103 complete the public Trust
evidence pipeline: Ticket 101 defines the versioned evidence and freshness
contract, Ticket 102 publishes post-deployment provenance, dependency,
integrity, route, migration, and RLS evidence, and Ticket 103 renders normalized
results on the public Trust page and machine route. Ticket 104 hardens security
inbox delivery and filtered-folder monitoring. Ticket 105 removes or records a
bounded upstream exception for the browser-push Node deprecation warning.
Ticket 102 depends on Tickets 092 and 098-101. Ticket 103 depends on Tickets
100-102. Tickets 104 and 105 depend only on their named completed evidence
tickets and may proceed independently of the Trust evidence pipeline.

Ticket 106 is complete (2026-08-31). The owner confirmed that active retention
settings were verified, the privacy mailbox passed its route test, legal review
approved the final Privacy and Terms text, and all publication approvals are
complete. The final policy uses the active one-day Vercel and seven-day
Supabase routine-log windows instead of the unsupported 30-day proposal.
Privacy and Terms are approved for publication. Public registration is
approved without changing the existing authentication implementation.

Ticket 106 includes the owner-requested marketing annotations and a header
link to the live, disclosed macOS preview release. Web and desktop runtime code
remain unchanged; future mobile remains deferred. Marketing build/check,
repository contracts, interaction and design-system checks, lint, typecheck,
1,369 tests, the web build, and desktop/390px browser QA pass. Lint retains
seven existing validator warnings.

Tickets 107–110 and 114 are complete locally under the owner's desktop plan.
Next.js stays at the repository root. Desktop uses shared core/UI over SQLite;
mobile, live sync, cloud desktop login, and desktop email delivery stay deferred.

Actual WKWebView QA covers tracking, Notes, timing across restart, review,
archive/restore, export privacy, approved merge, and representative keyboard
workflows. The final 0.3 build re-imported its own archive without duplicating
its passive Note. Its two native observations became passive history only.
Re-export retained the same ten configuration records; the next native preview
proposed zero creates, fifteen mappings, zero conflicts, and zero reminder writes.
Settings reported zero eligible and zero retained reminders after that merge.

The final arm64 app and DMG were verified on 2026-08-30 at 22:13 EDT. The app
has a sealed ad hoc signature and hardened runtime; the DMG is unsigned.
Read-only DMG contents match the app. These are local artifacts, not a signed
or notarized public release. The minimum declared and compiled OS is macOS 14;
execution on macOS 14 remains unverified.

Tickets 111 and 112 are complete after the 2026-08-31 disconnected-network and
system sleep/wake checks. Product fully quit delivery
and owner-assisted notification click/focus pass independently of the original spike.
Ticket 113 later completed the preview milestone; Ticket 115 owns deferred
Apple-trusted distribution. Ticket 106
publication approval remains independent of desktop distribution. Full evidence lives in
`docs/qa/2026-08-30-desktop-0.3-acceptance.md`.

Ticket 106 verification passed `agents:check`, `interactions:check`,
`resolvers:check`, `design-system:check`, lint, typecheck, 1,370 tests, the
application build, `marketing:check`, the marketing build,
`public-trust:check`, focused legal/public-copy tests, and `git diff --check`.
Lint retained seven existing warnings in the BehaviorLog reference validator
and reported no errors. Browser QA passed Privacy and Terms at 390px and
desktop widths with no horizontal overflow, draft labels, or browser errors.

No remediated finding from Tickets 079-083 or 093 remains local-only. Their
hosted migrations and application changes are deployed and verified.

The completed sequence includes the Ticket 001 Next.js scaffold, Ticket 002
Supabase Auth setup, Ticket 003 database schema, Tickets 004-012 core behavior
tracking and export, Ticket 013 Vercel deployment, BehaviorLog interoperability
and import/restore work through Ticket 028, public hardening and launch
readiness through Ticket 034, performance work through Ticket 047, UX and trust
work through Ticket 056, history/restore/schedule integrity through Ticket 060,
Ticket 061's export prompt library, and the project-definition and
agent-bootstrap layer.

The current UX backlog pass has completed implementation for Tickets 048-052:
UX research reproduction/triage, Settings baseline correctness, first-run
mobile layout robustness, Timeline daily workflow usability, and Needs Decision
interaction correctness. The pass stayed within the existing Timeline and
Settings surfaces and did not add new routes, dashboards, stored statuses,
provider operations, or out-of-scope product behavior.

Ticket 053 is complete. Browser reminder copy now separates behavior-level
intent from current-device delivery readiness, and service-worker notification
clicks are covered by a regression test that navigates an existing same-origin
Cadence tab to the intended Timeline URL before focusing it.

Ticket 054 is complete. Clear decision is scoped to selected behavior-date
review, and an owner-approved proxy browser walkthrough verified the heatmap
review path at desktop and 390px.

Ticket 055 is complete. Import apply is bound to the exact accepted
merge-preview run and its bundle, local-data, and combined preview fingerprints;
the binding, restore-preview timestamp correction, safety-count disclosure,
fixture-backed browser QA, and final repository-wide verification pass locally.

Ticket 056 is complete. Owner-approved agent-proxy browser walkthroughs found
that the homepage blurred Cadence with BehaviorLog and used ambiguous "open
tracker" language. The revised first viewport now names Cadence as the
open-source personal tracker and BehaviorLog as its portable export file
format. Reruns passed discovery, portability, and pre-login trust tasks. This
is proxy evidence only; real-user testing remains necessary before claiming
externally validated comprehension.

Ticket 057 is complete. Behavior title and description revisions now
have append-only, owner-scoped history with atomic baseline/change writes, and
the history is included in full JSON and BehaviorLog exports. Its migration was
deployed to hosted Supabase on 2026-07-13.

Ticket 058 is complete. Manual status transitions now persist the
occurrence snapshot, append-only event, and resolver-planned reminder
cancellation in one owner-scoped transaction with idempotency and ABA guards.
Its migration was deployed to hosted Supabase on 2026-07-13.

Ticket 059 is complete. Restore apply now binds one exact accepted
preview and canonical payload, verifies stale-row preconditions, and commits
product writes, definition history, provenance, and the applied ledger in one
idempotent transaction. Its migration was deployed to hosted Supabase on
2026-07-13.

Ticket 060 is complete. The idempotent schedule-integrity migration was
deployed to hosted Supabase on 2026-07-17, the affected stale account was
resynced through the protected production route, and the compatible
application was deployed to Vercel production. Privacy-safe SQL proof and an
authenticated browser walkthrough confirmed zero active empty schedules,
owner-consistent schedule slots, exactly-once repaired occurrences, preserved
manual history, Needs decision visibility, current/future Timeline rows, and a
fresh post-sync horizon without past reminder deliveries.

Product posture update: Cadence is now scoped as a public, open-source
single-account personal behavior tracker product. The current implemented
surfaces are the authenticated Next.js web app and a sibling Astro marketing
site under `apps/marketing`. Tickets 107–114 implement a Tauri desktop app with
local tracking parity; mobile remains future work. The existing web app and
marketing deployment remain intact. The scheduled workspace and public
marketing scope live in `docs/PUBLIC_PRODUCT_ARCHITECTURE.md`.

Current evidence:

- `package.json` and `package-lock.json` exist with Next.js App Router, TypeScript, Tailwind, ESLint, Vitest, npm workspaces, and marketing workspace scripts.
- `app/`, `components/`, `lib/`, and `tests/` application directories exist.
- `apps/marketing` exists as a static Astro app with routes `/`, `/standard`,
  `/cadence`, `/examples`, `/docs`, and `/about`, plus Markdown mirrors,
  `llms.txt`, `llms-full.txt`, a route manifest, sitemap, robots output, and a
  build-generated sanitized example BehaviorLog bundle. It is deployed as the
  separate Vercel project `cadence-marketing` with production alias
  `https://cadence-marketing-two.vercel.app`.
- Primary app routes exist for Timeline, Behaviors, Export, and Settings. `/analytics` remains as a protected compatibility redirect to `/behaviors`. Public account-information routes exist for Terms, Privacy, and Trust. Export is implemented with JSONL, CSV, full JSON backup, BehaviorLog bundle, Markdown AI summary outputs, and BehaviorLog import.
- Supabase SSR auth utilities exist under `lib/supabase/`, with Google login at `/login`, OAuth callback handling at `/auth/callback`, and protected app routes guarded by `proxy.ts` plus the app layout.
- Supabase CLI has been initialized with `supabase/config.toml`; local Supabase uses the 5532x port range to avoid conflicts with another local Supabase stack.
- Product database schema exists in `supabase/migrations/20260607204951_create_database_schema.sql` with RLS-enabled profiles, categories, behaviors, occurrences, reminder_deliveries, and push_subscriptions tables. Ticket 010 adds `supabase/migrations/20260608011000_add_reminder_delivery_processing_claim.sql` for an internal `reminder_deliveries.processing_started_at` claim timestamp.
- Auth user onboarding creates a profile and default categories; migration backfills existing auth users.
- Supabase database types are generated in `lib/db/database.types.ts`, with hand-written domain aliases in `lib/types/database.ts`.
- A pure Temporal-based recurrence resolver exists in `lib/resolvers/recurrence.resolver.ts`, with recurrence domain types in `lib/types/recurrence.ts` and paired tests in `tests/recurrence.resolver.test.ts`.
- Behavior CRUD exists on `/behaviors` with server actions, service/repository access through the authenticated Supabase user, category selection, recurrence editing, scheduled time, browser/email reminder settings, active/archive handling, and active/archived lists.
- Occurrence generation exists in `lib/resolvers/occurrence.resolver.ts`, `lib/services/occurrence.service.ts`, and `lib/db/occurrences.repo.ts`. Behavior create/edit/archive marks the user's occurrence horizon stale, while Timeline, Behaviors review, Export, and the protected occurrence sync route repair the rolling occurrence window before generated occurrences are needed. Sync inserts missing rows idempotently, removes stale future unresolved rows, and preserves past or resolved occurrence history.
- Timeline grouping exists in `lib/resolvers/timeline.resolver.ts`, `lib/services/timeline.service.ts`, and `/timeline`. The page syncs missing occurrences before rendering, surfaces Needs decision for prior unresolved active-behavior occurrences plus same-day retained prior decisions through a floating lower-right button and modal, starts the forward timeline at the current local day, shows the next 7 days by default, and can expand future visibility up to the generated 30-day horizon.
- Status marking and note editing exists in `lib/resolvers/status.resolver.ts`, `lib/services/occurrence.service.ts`, `app/(app)/timeline/actions.ts`, and Timeline row controls. Completed and Not Completed actions update `status_marked_at`; Completed also sets `completed_at`; switching away from Completed clears `completed_at`; note-only edits preserve status timestamps.
- Browser push subscription storage exists at `app/api/push/subscribe/route.ts`, `lib/services/push-subscription.service.ts`, and `lib/db/pushSubscriptions.repo.ts`; subscription registration validates endpoint/key shape, stores active subscriptions through the authenticated Supabase user context, lists active subscriptions for browser-push sends, and marks expired subscriptions inactive.
- Reminder delivery planning exists in `lib/resolvers/reminder.resolver.ts`, `lib/services/reminder.service.ts`, and `lib/db/reminderDeliveries.repo.ts`. Occurrence sync now creates missing pending reminder deliveries idempotently from behavior reminder settings, including browser reminders enabled by default, and status resolution cancels pending deliveries for resolved occurrences.
- Reminder processing code exists at `app/api/reminders/process/route.ts`, `lib/services/reminder.service.ts`, `lib/db/reminderDeliveries.repo.ts`, `lib/services/sequenzy.service.ts`, and `lib/services/web-push.service.ts`. The protected process route validates `REMINDER_PROCESS_SECRET` or `CRON_SECRET`, rate-limits repeated auth failures, bounds manual batch size, claims due pending email and browser-push deliveries with `processing_started_at`, re-checks current occurrence/behavior eligibility through the reminder resolver, sends Sequenzy template emails or VAPID-backed browser push from server-only code, and records sent, failed, or cancelled outcomes. Sequenzy provider setup is verified with transactional slug `habit-reminder`; local `.env.local` has `SEQUENZY_REMINDER_TEMPLATE_SLUG=habit-reminder`.
- Behavior review uses `lib/resolvers/analytics.resolver.ts`, `lib/services/analytics.service.ts`, and `/behaviors`. The resolver owns range normalization, adherence math, status counts, overall and per-behavior heatmap day states, category counts, and behavior date review rows for status/note correction. Default adherence excludes unresolved occurrences, the top summary Unresolved count matches the Timeline Needs decision count, and per-behavior/category detail count grids render only Completed and Not Completed while unresolved remains visible through heatmap and review states.
- Export exists in `lib/resolvers/export.resolver.ts`, `lib/services/export.service.ts`, `/export`, and `/api/export/jsonl`, `/api/export/csv`, `/api/export/json`. The resolver owns range filtering, archived-behavior filtering, JSONL, CSV escaping, full JSON backup shape, and Markdown AI summary adherence math. All-time export includes occurrences through the current local day and excludes generated future rows.
- Settings now shows profile email, timezone detection/manual override, notification permission status, browser push availability, a browser reminder enable/save control, Trust/Privacy/Terms links, and account deletion with export acknowledgement plus typed confirmation. Timezone detection uses browser/OS `Intl` data without geolocation; saving a changed timezone updates the profile, active behavior timezones, and future unresolved occurrences through the existing occurrence sync. The client path uses only `NEXT_PUBLIC_VAPID_PUBLIC_KEY`; the processing/sending layer uses server-only `VAPID_PRIVATE_KEY`.
- Timeline now shows a dismissible first-run setup pop-up for accounts that have
  not completed required launch setup items. It links into the existing
  Behaviors create form, Settings notification subscription, Settings timezone,
  and optional Export import controls without requesting notification permission
  on page load.
- Privacy-safe structured monitoring events now cover OAuth callback failures,
  push subscription route outcomes, and reminder processor outcomes through
  runtime logs. The sanitizer drops sensitive keys and redacts email-shaped
  values before logging.
- `npm run smoke:rls` runs a many-user Supabase RLS smoke check using
  service-role credentials only for temporary user setup/cleanup and ordinary
  signed-in publishable-key clients for isolation checks.
- A minimal `public/push-service-worker.js` displays received push payloads and opens same-origin app URLs, defaulting to `/timeline`. It does not implement PWA install, route caching, background sync, offline writes, or offline mutation.
- The Supabase CLI is installed as a dev dependency. The Sequenzy CLI runs through an exact-version isolated `npm exec` script. Both remain exposed through `npm run supabase -- ...` and `npm run sequenzy -- ...`.
- Agent operations docs now include Supabase CLI workflow, Sequenzy CLI workflow, date/time strategy, route map, and deterministic drift checks.
- A local/dev-only design-system bench exists at `/design-system`, backed by
  `design-system.config.json`, `design-system.surfaces.json`,
  `design-system.manifest.json`, `design-system.usage.json`, and
  `npm run design-system:check`. It renders foundations, canonical
  cross-surface component-family mappings, and fixture-backed web-app UI. It
  is not in primary navigation, is disabled in production builds, and keeps
  bench previews separate from product usage scans.
- The v1 feature ticket sequence is complete through Ticket 012. Ticket 013 Vercel production hardening is complete after later browser-push production verification: authenticated production smoke QA passed for Google login, Behavior create/archive, Timeline occurrence generation, status changes, notes, Settings render, Analytics render, Export page/link rendering, production reminder cron execution, browser push subscription, and a safe browser-push send.
- Vercel plugin inspection found existing project `cadence` under team `Emi's projects`, connected to GitHub repo `emixd12/habit-tracking-app` on `main`, with canonical public alias `https://cadence-blush-three.vercel.app`. Production public Supabase config is present, `/login` renders without the missing-config warning, Google OAuth returns to the canonical production domain, and `/api/reminders/process` supports Vercel Cron `GET` with secret protection.
- Project-local design workflow files exist under `.agents/skills/impeccable/` and should be used for UI/design work after the scaffold exists.

## Multi-account Supabase launch readiness sign-off

Status: complete.

Scope:
- Ticket 034 has been added to `docs/TICKETS.md` to close the remaining
  readiness gates before inviting additional public accounts onto the hosted
  web app.
- The ticket covers the restore-apply migration defect, hosted schema
  congruence, hosted many-user RLS smoke QA, hosted Auth/provider/account
  settings, and a minimal production Google sign-in smoke.

Current state:
- The restore-apply readiness defect has been fixed by
  `supabase/migrations/20260625220756_fix_behaviorlog_restore_apply_rpc.sql`.
  The corrective migration replaces the invalid Behavior restore upsert
  conflict target with `on conflict (id)` while preserving authenticated-user
  ownership filtering.
- `supabase/migrations/20260625221334_harden_internal_function_permissions.sql`
  pins `public.set_updated_at()` to `search_path = public` and removes direct
  app-role execute privileges from internal trigger functions.
- Hosted Supabase migrations have been pushed through `20260625221334`.
  Hosted migration history now matches local migration history, and hosted
  schema probes confirmed `occurrence_sync_state` exists, the restore RPC is
  corrected, internal trigger functions are not directly executable by
  `anon` or `authenticated`, and restore apply remains callable only by
  `authenticated`.
- Hosted Supabase advisors passed with `--fail-on error`. Remaining hosted
  warnings are the intentional authenticated restore `SECURITY DEFINER` RPC,
  leaked password protection being disabled in hosted Auth settings, and
  pre-existing RLS init-plan performance warnings on older policies.
- Static RLS registry coverage now also checks that every user-owned public
  table has explicit authenticated Data API grants, matching Supabase's 2026
  default-grants posture. The intentionally append-only
  `occurrence_status_events` table remains limited to `select, insert`.
- Current Supabase docs/changelog were reviewed on 2026-06-25 for Auth redirect
  allow lists, Google OAuth callback handling, RLS/Data API grants, and
  `SECURITY DEFINER` function permissions. The relevant launch-readiness rules
  remain: production OAuth should use an exact callback redirect, exposed public
  tables need both RLS and explicit grants, and privileged functions need
  explicit execute grants/revokes plus pinned `search_path`.
- A read-only hosted recheck on 2026-06-25 confirmed local and hosted migration
  histories match through `20260625221334`, all 50 expected authenticated table
  privileges across user-owned tables are present, `anon` cannot execute the
  restore RPC or internal updated-at trigger function, `authenticated` can
  execute the restore RPC, and `authenticated` cannot directly execute the
  internal updated-at trigger function.
- A non-mutating production HTTP smoke on 2026-06-25 confirmed `/login`
  returns 200, unauthenticated `/timeline` redirects to `/login?next=...`, and
  `/auth/google?next=/timeline` redirects to Supabase Google OAuth with the
  production `/auth/callback` redirect URL.
- Hosted many-user RLS smoke QA passed on 2026-06-25 against the confirmed
  project `qjodzutjxtmtzczbloxa.supabase.co`. The smoke created two temporary
  hosted users, verified six cross-account ownership checks through ordinary
  signed-in publishable-key clients, and cleaned up the temporary users.
- Hosted Auth/provider settings were audited on 2026-06-25 through the
  Supabase Management API without printing secret values. Passing launch
  signals: production Site URL is `https://cadence-blush-three.vercel.app`,
  the production `/auth/callback` URL is allow-listed, Google provider is
  enabled, public signup is enabled, anonymous users are disabled, manual
  identity linking is disabled, phone/SMS auth is disabled, Google nonce checks
  are not skipped, secure email change is enabled, and Auth rate limits are
  configured.
- Hosted Auth audit findings still needing owner decision before broad launch:
  email/password auth remains enabled at the provider level even though the
  product UI exposes Google login only; CAPTCHA/bot protection is disabled;
  leaked-password protection is disabled; localhost callback URLs remain
  allow-listed for development.
- Launch posture decision: first-stage public production launch remains
  Google-login only. Hosted email/password auth is temporarily retained as
  non-user-facing operational/test support while more hosted verification is in
  progress; it should be disabled before broad public account expansion unless
  a later explicit decision changes the product auth posture.
- Launch posture decision: leaked-password protection is not launch-blocking
  once production email/password auth is disabled, because no user password
  flow will remain. CAPTCHA/bot protection is not required for the Google-only
  first-stage launch, but should be revisited before any future email/password,
  passwordless email, OTP, anonymous sign-in, or native Supabase auth surface.
- Production authenticated smoke passed on 2026-06-25 using an existing Chrome
  production session: protected Timeline rendered, profile/default account data
  was present, a temporary smoke behavior was created, Timeline occurrence
  generation showed the new occurrence with Completed/Not Completed controls,
  Export showed JSONL/CSV/full JSON/BehaviorLog download links, Settings showed
  the account deletion export acknowledgement, typed confirmation input, and
  Delete account button, and the temporary smoke behavior was archived.
- A fresh Google OAuth attempt on 2026-06-25 reached the Google account chooser
  with the production callback URL, but the account selection/callback was not
  completed because it requires the user to choose a Google account in Chrome.

Next actions:
- Keep hosted email/password auth enabled only while current hosted testing
  needs it; disable it before broad public account expansion, or record a new
  explicit auth-scope decision.
- Before disabling hosted email/password auth, update or replace hosted smoke
  paths that currently rely on temporary password users.
- Remove localhost callback URLs from the production Supabase project before
  broad public account expansion, or record a time-boxed development exception.
- Finish the fresh production Google OAuth callback by choosing the intended
  Google account in Chrome, then record the sanitized callback result.

## Web App Performance Speed Loop

Status: complete.

Scope:
- Measure production-first and local user-perceived speed for route loads,
  navigation, feature buttons, behavior CRUD, Timeline status/note actions,
  Analytics review, Export downloads, Settings controls, and app-shell
  interactions.
- Implement improvements sequentially, starting with low-risk changes and now
  including scoped performance architecture tickets where evidence shows the
  read-route sync model is the bottleneck. Avoid product-scope expansion,
  offline/PWA mutation support, and unrelated rewrites.
- Keep a before/after measurement record in
  `docs/PERFORMANCE_SPEED_LOG.md`.

Current state:
- Tickets 042-046 are complete as a coordinated performance follow-up.
  Ticket 042 found no Vercel/Supabase region mismatch: production functions are
  in Vercel `iad1`, and the linked Supabase project is in `us-east-1`.
  Ticket 043 added and deployed a narrow authenticated Export-page read RPC.
  Ticket 044 added a per-user read-through cache for stable authenticated data.
  Ticket 045 added Timeline optimistic UI for Completed and Not Completed
  status actions. Ticket 046 changed Behavior create to return a small
  server-confirmed view model and update the current list without revalidating
  `/behaviors`.
- Ticket 047 is complete. `CADENCE_PERF_LOG=1` is now configured in Vercel
  Production, deployment `dpl_GyGQSJX5dCQzyRxA4zXyiEH8K7SN` is `READY`, and
  production Vercel logs now include sanitized `performance_timing` server
  spans for authenticated route loads.
- A 2026-06-30 first-screen transfer pass is complete. Timeline no longer
  preloads `completion-chime.mp3` on initial render; browser measurements show
  52KB less compressed transfer on both desktop and mobile with pixel-identical
  screenshots. Details are recorded in `docs/PERFORMANCE_SPEED_LOG.md`.
- Initial measurement plan, feature test matrix, and intervention backlog have
  been added in `docs/PERFORMANCE_SPEED_LOG.md`.
- Production baseline measurements have been recorded for unauthenticated HTTP,
  authenticated Chrome route loads, authenticated client navigation, Behavior
  create/archive, Timeline status, and Timeline note save behavior.
- First low-risk implementation batch is complete locally: service reads are
  parallelized/reused for Timeline, Analytics, and Export; sync now processes
  independent behaviors in parallel; static brand/sound assets have short
  durable cache headers; Chrome-extension body hydration noise is suppressed;
  completion chime preloading is deduped; Timeline note saves avoid full route
  revalidation.
- A second low-risk sync batch is complete locally: per-behavior generation
  reads existing occurrences and schedule slots in parallel, and reminder
  planning reuses the already-fetched occurrence list when generation made no
  occurrence mutations.
- A third local optimization batch is complete: route-load occurrence sync now
  preserves parallel per-behavior reads while batching stable create/delete and
  reminder delivery writes across behaviors; protected route services reuse a
  request-scoped Supabase Auth user lookup; Timeline now shares behavior and
  timezone reads between the feed and first-run setup state.
- Local production-build after-change route measurements have been recorded.
  Production after-change measurements are now recorded in
  `docs/PERFORMANCE_SPEED_LOG.md`.
- Ticket 035 performance server timing instrumentation is complete locally.
  `CADENCE_PERF_LOG=1` now enables privacy-safe JSON timing spans for protected
  app layout auth, route data loads, occurrence sync phases, reminder
  planning/writes, and primary repository reads used by Timeline, Behaviors,
  Analytics, and Export. `npm run perf:routes` provides a repeatable local or
  production HTTP route timing harness without printing cookies or response
  bodies.
- Ticket 035 authenticated local production-build measurement is recorded in
  `docs/PERFORMANCE_SPEED_LOG.md`. The first span sample shows read-route
  occurrence sync and reminder planning remain the dominant costs; no speed
  improvement was attempted in this evidence-only ticket.
- Ticket 036 route loading/navigation response is complete locally. A shared
  authenticated app loading boundary now covers Timeline, Behaviors,
  Analytics, Export, and Settings, and the app shell marks clicked primary nav
  links as pending without changing Next `Link` prefetch behavior. Local
  production-build browser QA covered desktop `1280x900` and mobile `390x844`
  route checks with no horizontal overflow or browser console warnings.
- Ticket 037 occurrence sync freshness state is complete locally. A new
  RLS-protected `occurrence_sync_state` table records each user's sync
  timezone/horizon, stale reason, last successful sync timestamp, and aggregate
  counts. Repository/service helpers read state, mark it stale, mark it fresh
  after successful account sync, and decide if a requested local-date horizon is
  covered. Behavior create/edit/archive/restore, Settings timezone save, and
  BehaviorLog import/restore apply paths now update the freshness contract
  without removing read-route occurrence sync yet. The hosted Supabase project
  now has the Ticket 037 migration after the authorized 2026-06-25 `db push`.
- Ticket 038 occurrence sync removal from hot read routes is complete locally.
  Timeline, Analytics, and Export now use freshness-aware occurrence sync
  checks instead of unconditional full sync. The occurrence planner no longer
  lets smaller read-route horizons delete unresolved rows beyond the requested
  window. A new protected `/api/occurrences/sync` route and daily Vercel Cron
  entry keep account horizons extendable in the background. Behavior
  create/edit/archive/restore now mark the horizon stale and defer the heavy
  sync to the next freshness-aware read or background sync process; Settings
  timezone save still performs immediate sync because the timezone contract
  requires updating active behavior schedules and future unresolved occurrences
  together. Local stack timing with
  `CADENCE_PERF_LOG=1` confirmed covered read routes emit
  `service.ensure_user_occurrences_fresh` with `covered=1` and `synced=0`.
- The hosted schema blocker for Ticket 038 production timing is resolved:
  hosted Supabase migration history now matches local through
  `20260625221334`, including `occurrence_sync_state`. Hosted production timing
  has now been measured against the current production deployment.
- Ticket 039 reminder planning decoupling is complete locally. Occurrence
  freshness repair during Timeline, Analytics, and Export page reads now
  suppresses reminder-delivery planning writes, while behavior/timezone/import/
  restore write paths and the protected occurrence horizon sync process still
  plan or cancel reminder deliveries. `docs/NOTIFICATION_SPEC.md` documents
  that reminder delivery planning belongs on write/background paths, not route
  rendering.
- Ticket 040 auth/app-shell latency reduction is complete locally. The
  protected proxy now uses Supabase Auth `getClaims()` for route gating and
  login/root redirects, with a `proxy.auth.get_claims` timing span. The
  authenticated app layout still uses `getUser()` for account display name and
  email, and settings/account paths that need authoritative user details remain
  unchanged. Local stack smoke confirmed unauthenticated protected-route
  redirect, anonymous `/login`, authenticated `/settings`, authenticated
  `/login?next=/settings` redirect, and browser-rendered `/timeline`,
  `/behaviors`, and `/settings`.
- Ticket 041 query evidence review is complete locally with no schema change.
  A local production-build route matrix after Tickets 038-040 showed primary
  routes in roughly 22-56ms through authenticated curl, and warm occurrence
  repository spans in the low single-digit milliseconds. Existing indexes cover
  the measured Timeline, Analytics, Export, and reminder due-delivery query
  shapes. No Supabase migration, generated type update, or Timeline read RPC was
  added because the evidence does not show an index/RPC bottleneck.
- Ticket 041 production-side validation is complete. Vercel production
  deployment `dpl_3XUkDXzhPi2M7oexyJWGAvuRn4md` is `READY`, points at commit
  `8ed1b3b734814d2fcd6725a252a8972f6160b6c5`, and built successfully in
  `iad1`.
- Authenticated production route medians improved materially for the previously
  slow routes compared with the baseline: Timeline `833ms` versus `2272ms`,
  Analytics `850ms` versus `2263ms`, and Export `967ms` versus `1642ms`.
  Behaviors improved to `637ms`; Settings stayed roughly similar at `644ms`.
- Authenticated production navigation is now around `0.8-1.1s` across the
  primary app routes in the measured pass. Timeline -> Behaviors is essentially
  unchanged from baseline, while Behaviors -> Analytics, Analytics -> Export,
  and Settings -> Timeline improved substantially.
- Production static asset cache headers are active for the raw logo and
  completion chime assets, returning
  `public, max-age=86400, stale-while-revalidate=604800` and Vercel cache hits
  during the header check.
- Mobile production sanity at `390x844` rendered Timeline, Behaviors,
  Analytics, Export, and Settings with no document-level horizontal overflow.
  A clean mobile-first production tab had no warning or error console entries.
- No index, RPC, cache, offline, or UI-scope expansion is justified by the
  production validation evidence. Future performance ideas remain future-only
  until a later hosted or seeded high-cardinality timing pass identifies a
  specific bottleneck.
- A 2026-06-26 follow-up speed pass is complete locally. It switched ordinary
  authenticated app user-id reads from full Supabase Auth `getUser()` calls to
  verified claims, preloads occurrence freshness state into Timeline,
  Analytics, and Export, streams protected route content behind immediate page
  shells, reuses one BehaviorLog import-run query for both Export import and
  restore panels, removes redundant occurrence reads from note/status actions,
  and moves behavior CRUD off eager occurrence/reminder sync.
- Final local production-build authenticated route matrix after the follow-up,
  using the same cookie harness and a populated temporary test account, showed
  median TTFB under 15ms for every app page: Timeline `12.5ms`, Behaviors
  `10.8ms`, Analytics `7.7ms`, Export `11.3ms`, Settings `8.7ms`. Full HTML
  stream medians were Timeline `386.8ms`, Behaviors `188.3ms`, Analytics
  `366.8ms`, Export `588.4ms`, Settings `179.8ms`.
- Create-behavior action timing on the same local production build improved
  from `2446ms` before behavior-action changes to `715ms` after deferring
  occurrence sync, removing the category/profile pre-reads from create, using
  insert-only schedule-slot creation, and avoiding the heavy joined behavior
  insert result. It remains above the requested 100ms because a normal Next
  form action still performs hosted database writes and re-renders the
  Behaviors page.
- The strict "every full page and action under 100ms" target was not reached
  under the repeatable local-to-hosted-Supabase conditions. Warm server auth
  and shell TTFB are now under 100ms; full authenticated data streams and
  mutation actions are bounded by one or more hosted Supabase round trips
  measured around 155-200ms from this machine, plus required post-action
  re-render work.

Verification:
- 2026-06-26 follow-up pass: `npm run agents:check`.
- 2026-06-26 follow-up pass: `npm run resolvers:check`.
- 2026-06-26 follow-up pass: `npm run lint`.
- 2026-06-26 follow-up pass: `npm run typecheck`.
- 2026-06-26 follow-up pass: `npm run test` (50 files, 307 tests).
- 2026-06-26 follow-up pass: `npm run build`.
- 2026-06-26 follow-up pass: `npm run design-system:check`.
- 2026-06-26 follow-up pass: `git diff --check`.
- 2026-06-26 follow-up measurement: local production-build
  `npm run perf:routes` with authenticated cookie header across `/timeline`,
  `/behaviors`, `/analytics`, `/export`, and `/settings`.
- 2026-06-26 follow-up measurement: HTTP form-action probe for create
  behavior against local `next start`, improving from `2446ms` to `715ms`.
- 2026-06-26 follow-up production deploy:
  `npx vercel deploy --prod --yes --scope emis-projects-4c886aeb` created deployment
  `dpl_VgjDqGJ82FoMK4SK6Kafh8yw78sX`, which is `Ready` and aliased to
  `https://cadence-blush-three.vercel.app`.
- 2026-06-26 follow-up production smoke:
  `npx vercel inspect cadence-f8scieqv5-emis-projects-4c886aeb.vercel.app --scope emis-projects-4c886aeb`;
  unauthenticated production `npm run perf:routes` returned protected-route
  `307` redirects; direct `curl` confirmed `/login` returns `200` and
  `/timeline` redirects to `/login?next=%2Ftimeline`.
- 2026-06-26 cleanup pass:
  `CADENCE_TEST_LOGIN_MAX_AGE_HOURS=0.001 npm run test-login:cleanup`
  checked 5 hosted users and deleted 4 stale temporary test-login users.
- Ticket 042 pass: read-only production provider evidence confirmed Vercel
  production deployment `dpl_J82v2C9abHaoPSZBRR7EcdEsLNFB` is in region
  `iad1`, the linked Supabase project `qjodzutjxtmtzczbloxa` is in `us-east-1`,
  and authenticated Chrome route medians were Timeline `710ms`, Behaviors
  `582ms`, Analytics `591ms`, Export `634ms`, and Settings `253ms`.
- Ticket 042 note: production server-side Supabase timing spans were
  unavailable because `CADENCE_PERF_LOG` is not configured in production and
  Vercel logs contained no `performance_timing` events.
- Ticket 042 pass: `npm run agents:check`.
- Ticket 043 pass: `SUPABASE_NO_TELEMETRY=1 npm run supabase -- db reset`.
- Ticket 043 pass:
  `SUPABASE_NO_TELEMETRY=1 npm run --silent supabase -- gen types typescript --local > lib/db/database.types.ts`.
- Ticket 043 pass:
  `SUPABASE_NO_TELEMETRY=1 npm run supabase -- db advisors --local --type all --fail-on error`
  returned no error-level findings; remaining warnings are pre-existing RLS
  init-plan performance warnings.
- Ticket 043 hosted pass:
  `SUPABASE_NO_TELEMETRY=1 npm run supabase -- db push --linked --dry-run`
  showed only `20260626032324_add_export_page_read_rpc.sql`.
- Ticket 043 hosted pass:
  `SUPABASE_NO_TELEMETRY=1 npm run supabase -- db push --linked --yes`
  applied `20260626032324_add_export_page_read_rpc.sql`.
- Ticket 043 hosted pass:
  `SUPABASE_NO_TELEMETRY=1 npm run supabase -- migration list --linked`
  confirmed local and hosted migration histories match through `20260626032324`.
- Ticket 043 hosted pass: hosted `db query --linked` confirmed
  `get_export_page_read_bundle(date, date)` is `SECURITY INVOKER`
  (`prosecdef=false`), has `search_path=public`, is not executable by `anon`,
  and is executable by `authenticated`.
- Ticket 044/045/046 focused pass:
  `npx vitest run tests/user-read-cache.test.ts tests/behavior-create.service.test.ts tests/behavior-actions.test.ts tests/behavior-list-state.test.ts tests/timeline-optimistic-status.test.ts tests/settings.service.test.ts tests/behaviorlog-import-ui.test.tsx tests/behaviorlog-restore-ui.test.tsx tests/export.resolver.test.ts`
  (9 files, 42 tests).
- Tickets 043-046 pass: `npm run agents:check`.
- Tickets 043-046 pass: `npm run resolvers:check`.
- Tickets 043-046 pass: `npm run lint`.
- Tickets 043-046 pass: `npm run typecheck`.
- Tickets 043-046 pass: `npm run test` (55 files, 320 tests).
- Tickets 043-046 pass: `npm run build`.
- Tickets 043-046 pass: `npm run design-system:check`.
- Tickets 043-046 pass: `git diff --check`.
- Tickets 043-046 production deploy:
  `npx vercel deploy --prod --yes --scope emis-projects-4c886aeb` created
  deployment `dpl_4FtW7Fhw9gmJeDLtHL5e836huGog`, which is `READY`, aliased to
  `https://cadence-blush-three.vercel.app`, and built in `iad1`.
- Tickets 043-046 production smoke: `curl` confirmed `/login` returns `200`,
  unauthenticated `/timeline` redirects to `/login?next=%2Ftimeline`, and
  unauthenticated `/export` redirects to `/login?next=%2Fexport`.
- Tickets 043-046 production authenticated Chrome timing medians:
  Timeline `963ms`, Behaviors `280ms`, Analytics `429ms`, Export `539ms`, and
  Settings `264ms`. All five routes rendered authenticated app content and did
  not redirect to login.
- Ticket 047 hosted pass:
  `npx vercel env ls production --scope emis-projects-4c886aeb` confirmed
  `CADENCE_PERF_LOG` is present in Production.
- Ticket 047 production deploy:
  `npx vercel deploy --prod --yes --scope emis-projects-4c886aeb` created
  deployment `dpl_GyGQSJX5dCQzyRxA4zXyiEH8K7SN`, which is `READY`, aliased to
  `https://cadence-blush-three.vercel.app`, and built in `iad1`.
- Ticket 047 authenticated Chrome route timing after enabling production
  server timing: Timeline median `1605ms`, Behaviors `275ms`, Analytics
  `748ms`, Export `417ms`, and Settings `344ms`; all five routes rendered
  authenticated app content and did not redirect to login.
- Ticket 047 hosted log pass:
  `npx vercel logs cadence-blush-three.vercel.app --scope emis-projects-4c886aeb --since 35m --query performance_timing --json`
  returned sanitized `performance_timing` events for proxy auth, app layout
  auth, Timeline bundle load, primary page data loads, Export RPC reads,
  occurrence freshness, and repository reads. The sampled app timing messages
  contained route/span names, durations, statuses, and aggregate counts only.
- Pass: `npx vitest run tests/occurrence.service.test.ts tests/reminder.service.test.ts tests/settings.service.test.ts tests/behaviorlog-import-ui.test.tsx tests/behaviorlog-restore-ui.test.tsx`
- Pass: `npm run resolvers:check`
- Pass: `npm run typecheck`
- Pass: `npm run lint`
- Pass: `npm run agents:check`
- Pass: `npm run test` (44 files, 271 tests)
- Pass: `npx vitest run tests/completion-feedback.test.ts`
- Pass: `npx vitest run tests/reminder.service.test.ts`
- Pass: `npm run build`
- Pass: `npm run design-system:check`
- Pass: `git diff --check`
- Ticket 035 pass: `npx vitest run tests/performance-timing.test.ts tests/occurrence.service.test.ts tests/reminder.service.test.ts`
- Ticket 035 pass: `npm run agents:check`
- Ticket 035 pass: `npm run resolvers:check`
- Ticket 035 pass: `npm run lint`
- Ticket 035 pass: `npm run typecheck`
- Ticket 035 pass: `npm run test` (45 files, 276 tests)
- Ticket 035 pass: `npm run build`
- Ticket 035 pass: local production-build measurement with
  `CADENCE_PERF_LOG=1`, authenticated Chrome route run, and unauthenticated
  `npm run perf:routes` smoke.
- Ticket 036 pass: `npm run agents:check`
- Ticket 036 pass: `npm run resolvers:check`
- Ticket 036 pass: `npm run design-system:check`
- Ticket 036 pass: `npm run lint`
- Ticket 036 pass: `npm run typecheck`
- Ticket 036 pass: `npm run test` (45 files, 276 tests)
- Ticket 036 pass: `npm run build`
- Ticket 036 pass: local production-build browser QA for `/timeline`,
  `/behaviors`, `/analytics`, `/export`, and `/settings` at desktop `1280x900`
  and mobile `390x844`; measured Timeline -> Behaviors and Settings ->
  Timeline click-to-loading/click-to-target timings in
  `docs/PERFORMANCE_SPEED_LOG.md`.
- Ticket 037 pass: `npx vitest run tests/behaviorlog-import-intervention-history.test.ts tests/occurrence-sync-state.service.test.ts tests/occurrence.service.test.ts tests/settings.service.test.ts tests/behaviorlog-import-write.service.test.ts tests/behaviorlog-restore-apply.service.test.ts tests/rls-policy-registry.test.ts`
- Ticket 037 pass: `npm run supabase -- db reset`
- Ticket 037 pass: `npm run --silent supabase -- gen types typescript --local > lib/db/database.types.ts`
- Ticket 037 pass: `npm run agents:check`
- Ticket 037 pass: `npm run resolvers:check`
- Ticket 037 pass: `npm run lint`
- Ticket 037 pass: `npm run typecheck`
- Ticket 037 pass: `npm run test` (46 files, 280 tests)
- Ticket 037 pass: `npm run build`
- Ticket 037 pass: `git diff --check`
- Ticket 038 pass: `npx vitest run tests/occurrence.resolver.test.ts tests/occurrence.service.test.ts tests/occurrence-sync-route.test.ts tests/occurrence-sync-state.service.test.ts`
- Ticket 038 pass: `npm run agents:check`
- Ticket 038 pass: `npm run resolvers:check`
- Ticket 038 pass: `npm run lint`
- Ticket 038 pass: `npm run typecheck`
- Ticket 038 pass: `npm run test` (47 files, 289 tests)
- Ticket 038 pass: `npm run build`
- Ticket 038 browser/API QA: local production-build route sanity for
  `/timeline`, `/behaviors`, `/analytics`, `/export`, and `/settings`; Export
  JSONL/CSV/full JSON/BehaviorLog API downloads returned 200; Settings
  timezone save updated one active behavior; Behavior edit/archive/restore
  succeeded. Analytics selected-day review rendered correction controls, but
  browser automation did not successfully submit that nested status form during
  this run; unchanged status/analytics server paths remain covered by focused
  tests.
- Ticket 039 focused pass: `npx vitest run tests/occurrence.service.test.ts tests/reminder.service.test.ts`
- Ticket 039 pass: `npm run agents:check`
- Ticket 039 pass: `npm run resolvers:check`
- Ticket 039 pass: `npm run lint`
- Ticket 039 pass: `npm run typecheck`
- Ticket 039 pass: `npm run test` (47 files, 293 tests)
- Ticket 039 pass: `npm run build`
- Ticket 039 pass: `git diff --check`
- Ticket 040 focused pass: `npx vitest run tests/supabase-proxy.test.ts tests/auth-callback-route.test.ts tests/auth-google-route.test.ts tests/test-login.test.ts`
- Ticket 040 focused pass: `npm run typecheck`
- Ticket 040 pass: `npm run agents:check`
- Ticket 040 pass: `npm run resolvers:check`
- Ticket 040 pass: `npm run lint`
- Ticket 040 pass: `npm run typecheck`
- Ticket 040 pass: `npm run test` (47 files, 297 tests)
- Ticket 040 pass: `npm run build`
- Ticket 040 pass: `git diff --check`
- Ticket 041 pass: local production-build route timing matrix for `/timeline`,
  `/behaviors`, `/analytics`, `/export`, and `/settings`.
- Ticket 041 pass: `npm run agents:check`
- Ticket 041 pass: `npm run resolvers:check`
- Ticket 041 pass: `npm run lint`
- Ticket 041 pass: `npm run typecheck`
- Ticket 041 pass: `npm run test` (47 files, 297 tests)
- Ticket 041 pass: `npm run build`
- Ticket 041 pass: `git diff --check`
- Ticket 041 production validation pass: Vercel project/deployment inspection
  confirmed production `READY` at commit
  `8ed1b3b734814d2fcd6725a252a8972f6160b6c5`.
- Ticket 041 production validation pass: Vercel build-log inspection for
  deployment `dpl_3XUkDXzhPi2M7oexyJWGAvuRn4md`.
- Ticket 041 production validation pass: unauthenticated production timing with
  `npm run perf:routes`.
- Ticket 041 production validation pass: authenticated production Chrome
  route-load timing and navigation timing for `/timeline`, `/behaviors`,
  `/analytics`, `/export`, and `/settings`.
- Ticket 041 production validation pass: authenticated mobile production
  sanity at `390x844` with no horizontal overflow.
- Ticket 041 production validation pass: safe missing-secret 401 checks for
  `/api/reminders/process` and `/api/occurrences/sync`.
- Ticket 041 production validation pass: production asset cache-header check
  for the raw logo and completion chime assets.
- Ticket 041 production validation documentation pass:
  `npm run agents:check`.
- Ticket 041 production validation documentation pass:
  `npm run resolvers:check`.
- Ticket 041 production validation documentation pass: `npm run lint`.
- Ticket 041 production validation documentation pass: `npm run typecheck`.
- Ticket 041 production validation documentation pass:
  `npm run test` (49 files, 302 tests).
- Ticket 041 production validation documentation pass: `npm run build`.
- Ticket 041 production validation documentation pass: `git diff --check`.
- Restore/Ticket 037 hosted schema pass:
  `npm run supabase -- db push --linked --dry-run` showed pending restore
  preview/apply, Ticket 037, and corrective restore RPC migrations.
- Restore/Ticket 037 hosted schema pass:
  `npm run supabase -- db push --linked --yes` applied
  `20260619090000`, `20260619093000`, `20260625204148`, and
  `20260625220756`; a second authorized push applied `20260625221334`.
- Restore/Ticket 037 hosted schema pass:
  `npm run supabase -- migration list --linked` confirmed local and hosted
  migration history match through `20260625221334`.
- Restore/Ticket 037 hosted schema pass: hosted `db query --linked` confirmed
  `occurrence_sync_state` exists, restore Behavior upserts use
  `on conflict (id)`, imported intervention upserts still use
  `(import_run_id, external_id)`, `anon` cannot execute restore/internal
  trigger functions, and `authenticated` can execute the restore RPC.
- Restore/Ticket 037 hosted schema pass:
  `npm run supabase -- db advisors --linked --type all --fail-on error`
  returned no error-level findings; remaining warnings are documented in the
  Ticket 034 and performance ledgers.
- Restore/Ticket 037 local pass:
  `npx vitest run tests/behaviorlog-restore-rpc-migration.test.ts tests/supabase-function-permissions-migration.test.ts tests/behaviorlog-restore-apply.service.test.ts tests/rls-policy-registry.test.ts tests/occurrence-sync-state.service.test.ts tests/occurrence.service.test.ts`
  (6 files, 20 tests).
- Restore/Ticket 037 local pass: `npm run supabase -- db reset`.
- Restore/Ticket 037 local pass:
  `npm run --silent supabase -- gen types typescript --local > lib/db/database.types.ts`.
- Restore/Ticket 037 local pass:
  `npm run supabase -- db advisors --local --type all --fail-on error`
  returned no error-level findings; remaining warnings are pre-existing RLS
  init-plan performance warnings.
- Ticket 034 pass: current Supabase docs/changelog reviewed for Auth redirect
  URLs, Google OAuth callback setup, RLS/Data API grants, and database function
  execute privileges. The relevant 2026 platform change is that new public
  tables need explicit grants in addition to RLS for Data API access.
- Ticket 034 pass:
  `npx vitest run tests/behaviorlog-restore-rpc-migration.test.ts tests/supabase-function-permissions-migration.test.ts tests/behaviorlog-restore-apply.service.test.ts tests/rls-policy-registry.test.ts`
  (4 files, 10 tests).
- Ticket 034 pass: `npm run supabase -- --version` returned `2.105.0`.
- Ticket 034 pass: `npm run supabase -- db reset`.
- Ticket 034 pass:
  `npm run supabase -- db advisors --local --type all --fail-on error`
  returned no error-level findings; remaining warnings are pre-existing RLS
  init-plan performance warnings.
- Ticket 034 read-only hosted pass:
  `npm run supabase -- migration list --linked` confirmed local and hosted
  migration history match through `20260625221334`.
- Ticket 034 read-only hosted pass: hosted `db query --linked` confirmed all
  50 expected authenticated table privileges are present across user-owned
  tables and restore/internal function execute privileges match the intended
  callable surface.
- Ticket 034 non-mutating production HTTP pass: `curl` checks confirmed
  `/login` returns 200, unauthenticated `/timeline` redirects to login, and
  `/auth/google?next=/timeline` starts Supabase Google OAuth with the
  production callback URL.
- Ticket 034 hosted smoke pass: `npm run smoke:rls` against
  `qjodzutjxtmtzczbloxa.supabase.co` created two temporary users, verified six
  ownership checks, and cleaned up the temporary users.
- Ticket 034 hosted Auth audit pass/finding: Supabase Management API
  `GET /v1/projects/qjodzutjxtmtzczbloxa/config/auth` confirmed production Site
  URL, production callback allow-listing, Google provider enabled, signup
  enabled, anonymous users disabled, manual identity linking disabled,
  phone/SMS auth disabled, Google nonce checks enforced, secure email change
  enabled, and Auth rate-limit values present. Findings: email/password auth
  enabled, CAPTCHA disabled, leaked-password protection disabled, and localhost
  callback URLs retained.
- Ticket 034 production authenticated smoke pass: Chrome session reached
  `/timeline`; a temporary behavior named `Ticket 034 production smoke ...` was
  created, appeared on Timeline with status controls, Export showed
  JSONL/CSV/full JSON/BehaviorLog links, Settings showed account deletion
  controls, and the temporary behavior was archived.
- Ticket 034 partial fresh Google OAuth pass: `/auth/google?next=/timeline`
  reached the Google account chooser with the production callback URL. The final
  account selection/callback is pending user action in Chrome.
- Ticket 034 pass: `npm run agents:check`.
- Ticket 034 pass: `npm run resolvers:check`.
- Ticket 034 pass: `npm run lint`.
- Ticket 034 pass: `npm run typecheck`.
- Ticket 034 pass: `npm run test` (49 files, 302 tests).
- Ticket 034 pass: `npm run build`.
- Ticket 034 pass: `git diff --check`.
- Restore/Ticket 037 local pass: `npm run agents:check`.
- Restore/Ticket 037 local pass: `npm run resolvers:check`.
- Restore/Ticket 037 local pass: `npm run lint`.
- Restore/Ticket 037 local pass: `npm run typecheck`.
- Restore/Ticket 037 local pass: `npm run test` (49 files, 301 tests).
- Restore/Ticket 037 local pass: `npm run build`.
- Restore/Ticket 037 local pass: `git diff --check`.

## Design-system surface catalog update

Status: complete.

Implementation summary:
- Added `design-system.surfaces.json` as the canonical cross-surface design
  catalog for the authenticated web app, Astro marketing site, future desktop
  app, and future mobile app.
- The catalog defines shared component-family contracts for foundations,
  text actions, form controls, navigation, surface shells, disclosure sections,
  Timeline feed, Needs decision, Analytics calendar, Behavior editor,
  Export/portability, and brand marks.
- Updated `/design-system` so the bench now shows surface cards and a canonical
  component-family matrix before the existing web-app trace cards. Web-app
  entries link back to live manifest trace anchors; Astro and future-surface
  entries point to native source files or planned implementation docs.
- Extended `npm run design-system:check` to validate the surface catalog for
  duplicate ids, missing sources, unknown surfaces, and unknown web manifest
  component references.
- Updated `docs/PUBLIC_PRODUCT_ARCHITECTURE.md`, `docs/OPERATIONS.md`, and
  `DESIGN.md` to document one canonical design system with surface-scoped
  implementations.

Verification:
- Pass: `npm run design-system:check`
- Pass: `npm run typecheck`
- Pass: `npm run lint`
- Pass: `npm run agents:check`
- Pass: `npm run resolvers:check`
- Pass: `npm run test` (41 files, 257 tests)
- Pass: `npm run build`
- Pass: `git diff --check`
- HTTP QA: existing Next dev server at `http://localhost:3000/design-system`
  returned 200 and rendered Surfaces, Canonical component families,
  Authenticated web app, Astro marketing site, and Timeline feed content.

Remaining risk:
- The global bench shows Astro and future desktop/mobile mappings, but only the
  authenticated web app has a strict live manifest today. Add native manifests
  or surface-specific benches when those surfaces have enough live UI to verify.

## Marketing Cadence positioning update

Status: complete.

Implementation summary:
- Repositioned the Astro marketing site around Cadence as the site brand,
  homepage lead, and public product name. BehaviorLog now reads as the open
  bundle standard and portability layer behind Cadence exports and imports.
- Updated the marketing header to use only the Cadence logo and name, launch
  route links for `Cadence` and `BehaviorLog`, and a persistent `Log in`
  action to the authenticated app. The footer keeps project links including
  `About`.
- Expanded marketing copy on the homepage, Cadence page, BehaviorLog page,
  Docs page, and About page. The Docs page now includes a quick-start contract
  and a future developer-docs structure for Guides, Reference, Examples, Agent
  policy, and Schema history.
- Applied the existing square ledger design primitives to the marketing header,
  CTA treatment, hero sizing, favicon, and docs tables. Mobile docs tables now
  scroll inside their own containers without document-level horizontal
  overflow.
- Updated source-of-truth docs and the cross-surface design catalog so future
  work does not restore the older BehaviorLog-led homepage posture.

Verification:
- Pass: `npm run marketing:build`
- Pass: `npm run marketing:check`
- Pass: `npm run design-system:check`
- Pass: `npm run agents:check`
- Pass: `npm run resolvers:check`
- Pass: `npm run lint`
- Pass: `npm run typecheck`
- Pass: `npm run test` (41 files, 257 tests)
- Pass: `npm run build`

Browser QA:
- Astro preview served at `http://localhost:4322/` because port `4321` was in
  use.
- Chrome/Playwright checks passed for `/`, `/cadence`, `/standard`, `/docs`,
  `/examples`, and `/about` at 1280x900 and 390x844.
- Verified 200 responses, no console warnings/errors, Cadence-only header
  brand with one logo image, `BehaviorLog` nav label, visible `Log in` action,
  no document-level horizontal overflow, and internally scrollable docs/example
  tables on mobile.
- Focused homepage QA verified that the hero capture does not overlap headline
  or body copy and that the next section is visible in the first 1280x900
  viewport.

Remaining risk:
- `/docs` is still a compact static entry point. The full developer-docs
  structure is scoped as future documentation work, now recorded in the site
  copy and source docs.

## Timeline UI feedback update

- Reworked first-run setup on `/timeline` from an inline feed band into a
  dismissible fixed pop-up so the current-day feed remains first in document
  flow.
- Updated Timeline resolver metadata so `not_completed` rows now match
  Completed row structure: compact resolved row, collapsed status label, and
  correction controls only after expanding.
- Cleaned up the Needs decision modal by removing the repeated Prior
  unresolved label, using white date groups, and showing each date's remaining
  unresolved count under the date label.

Verification for this update: Pass: `npx vitest run tests/timeline.resolver.test.ts`; Pass: `npm run agents:check`; Pass: `npm run resolvers:check`; Pass: `npm run lint`; Pass: `npm run typecheck`; Pass: `npm run test`; Pass: `npm run build`; Pass: `npm run design-system:check`; Pass: `git diff --check`.

Browser QA: authenticated in-app browser `/timeline` desktop render showed the
first-run setup as a fixed dismissible pop-up with no horizontal overflow. The
Needs decision modal no longer repeated Prior unresolved in the header, date
groups used a white background with `0 left to decide` under the date, and Not
Completed rows matched Completed row structure with a collapsed label and no
visible collapsed action buttons.

Browser QA: `/timeline` at 390px width showed no horizontal overflow; the fixed
Needs decision button stayed within the safe-area width; the modal was
full-height; and Completed and Not Completed retained rows had matching row
heights, labels, and no visible collapsed action buttons. Browser logs showed
no warnings or errors.

Follow-up modal header refinement:
- Removed the visible global Needs decision title and total-to-decide label
  from the open modal header while keeping the close control and accessible
  dialog label.
- Updated `DESIGN.md`, `docs/UI_SPEC.md`, and `docs/USER_FLOWS.md` so the open
  modal is led by date groups only.
- Verification: Pass: `npm run agents:check`; Pass: `npm run
  resolvers:check`; Pass: `npm run lint`; Pass: `npm run typecheck`; Pass:
  `npm run test`; Pass: `npm run design-system:check`; Pass: `npm run build`;
  Pass: `git diff --check`.
- Browser QA: design-system Needs decision dialog preview at 1127px and 390px
  opened with an empty visible header, exactly one close button, no visible
  heading or paragraph in the header, date-group text first, and no horizontal
  overflow.

Follow-up modal top-space refinement:
- Removed the remaining reserved header row from the open Needs decision modal.
  The close control is now pinned over the top-right corner, and the first date
  group starts at the top of the scroll area with right padding reserved for the
  close control.
- Updated `DESIGN.md`, `docs/UI_SPEC.md`, and `docs/USER_FLOWS.md` to specify
  the overlaid close control and no reserved header row.
- Verification: Pass: `npm run agents:check`; Pass: `npm run
  resolvers:check`; Pass: `npm run lint`; Pass: `npm run typecheck`; Pass:
  `npm run test`; Pass: `npm run design-system:check`; Pass: `npm run build`;
  Pass: `git diff --check`.
- Browser QA: design-system Needs decision dialog preview at 1127px and 390px
  opened with no modal header element, the close button pinned top-right, the
  first date group at the top of the scroll area, and no horizontal overflow.

Follow-up modal gutter refinement:
- Removed the asymmetric right padding from the Needs decision modal scroll
  area so date groups and occurrence rows stretch to matching left and right
  gutters. The date header text row alone reserves space for the overlaid close
  control.
- Updated `DESIGN.md`, `docs/UI_SPEC.md`, and `docs/USER_FLOWS.md` to document
  equal modal gutters with a close-control text guard.
- Verification: Pass: `npm run agents:check`; Pass: `npm run
  resolvers:check`; Pass: `npm run lint`; Pass: `npm run typecheck`; Pass:
  `npm run test`; Pass: `npm run design-system:check`; Pass: `npm run build`;
  Pass: `git diff --check`.
- Browser QA: design-system Needs decision dialog preview at 1032px, 1127px,
  and 390px showed equal left/right distances from the modal to the date group
  and first occurrence row, a pinned top-right close button, no modal header
  element, and no horizontal overflow.

## Agent operations update

This governance update added CLI-first Supabase and Sequenzy workflows, route/date-time/resolver registry docs, project-local CLI scripts, and deterministic drift checks.

Verification run for this update:
- Pass: `npm run agents:check`
- Pass: `npm run resolvers:check`
- Pass: `npm run lint`
- Pass: `npm run typecheck`
- Pass: `npm run test`
- Pass: `npm run build`
- Pass: `npm run supabase -- --version` returned `2.105.0`
- Pass: `npm run sequenzy -- --version` returned `0.0.34`
- Pass: `npm audit --omit=dev` found 0 vulnerabilities

Supabase is initialized for local development. Ticket 003 added the first product database migration and generated database types.

## Ticket status

| Ticket | Status | Implementation summary | Verification | Blockers / next action |
|---|---|---|---|---|
| 001: Initialize app | complete | Added Next.js App Router TypeScript scaffold with Tailwind v4, ESLint, Vitest, a responsive app shell, `/timeline`, `/behaviors`, `/analytics`, `/export`, and `/settings` placeholder routes, and a navigation smoke test. No database, auth, schema, or product feature logic added. | Pass: `npm run lint`; `npm run typecheck`; `npm run test`; `npm run build`; browser QA at desktop width and 390px mobile viewport; `npm audit --omit=dev` found 0 vulnerabilities. | Start Ticket 002: Add Supabase Auth. |
| 002: Add Supabase Auth | complete | Added `@supabase/ssr` and `@supabase/supabase-js`; created browser/server Supabase clients; initialized `supabase/config.toml`; added Google login at `/login`, OAuth callback exchange at `/auth/callback`, Next 16 `proxy.ts` session refresh/redirect handling, server-side app layout auth guard, sanitized auth redirect helpers, env docs, and auth redirect tests. No service-role key is used in browser code. | Pass: `npm run agents:check`; `npm run resolvers:check`; `npm run lint`; `npm run typecheck`; `npm run test`; `npm run build`; HTTP QA for `/`, `/timeline`, `/login`, and `/auth/callback`; browser QA for `/login` at desktop and 390px mobile plus protected `/timeline` redirect. | Start Ticket 003: Create database schema. Google OAuth still requires real Supabase project/provider credentials in local/deployed environment. |
| 003: Create database schema | complete | Added initial Supabase schema migration for profiles, categories, behaviors, occurrences, reminder_deliveries, and push_subscriptions; enabled owner-scoped RLS policies; added updated_at triggers, relationship ownership constraints, reminder/subscription idempotence constraints, auth-user profile/default-category onboarding, existing-user backfill, empty local seed placeholder, generated Supabase database types, and domain aliases for status/channel literals. Clarified that `profiles.id` is the profile ownership key instead of a separate `user_id`. Local Supabase ports moved to 5532x to avoid an existing local stack conflict. | Pass: `npm run supabase -- db reset`; Pass: SQL smoke check for default categories, profile/category RLS, cross-user insert rejection, and cross-user category-link rejection; Pass: `./node_modules/.bin/supabase gen types typescript --local > lib/db/database.types.ts`; Pass: `npm run agents:check`; Pass: `npm run resolvers:check`; Pass: `npm run lint`; Pass: `npm run typecheck`; Pass: `npm run test`; Pass: `npm run build`. | Start Ticket 004: Recurrence resolver. Hosted Supabase deployment still requires explicit user authorization before `npm run supabase -- db push`. |
| 004: Recurrence resolver | complete | Added `@js-temporal/polyfill`, recurrence rule/domain types, and a pure Temporal-based `resolveOccurrenceSchedule` resolver covering daily, every-N-days, weekly, every-N-weeks, monthly day-N with last-day fallback, local scheduled times, explicit timezones, optional local anchor dates for interval phase, and DST disambiguation. Updated `docs/RECURRENCE_RULES.md` so the resolver contract matches the locked Temporal strategy. | Pass: `npx vitest run tests/recurrence.resolver.test.ts`; Pass: `npm run agents:check`; Pass: `npm run resolvers:check`; Pass: `npm run lint`; Pass: `npm run typecheck`; Pass: `npm run test`; Pass: `npm run build`. | Start Ticket 005: Behavior CRUD. Future occurrence services should pass a stable local anchor date, such as behavior created/start date, for interval-based rules. |
| 005: Behavior CRUD | complete | Added behavior repository/service/server actions; implemented `/behaviors` create/edit/archive UI with category selection, recurrence editor, scheduled time, browser/email reminder settings, active toggle, active/archived sections, and preserved-history archive semantics via `active=false` plus `archived_at`. Updated `DESIGN.md` from the implemented behavior form/card patterns. Authenticated QA found and fixed client-side Supabase public env loading, callback provider-error handling, and edit-form stale defaults after successful saves. Hosted migration `20260607204951_create_database_schema.sql` was pushed after user authorization. | Pass: `npx vitest run tests/behavior-form.test.ts`; Pass: `npx vitest run tests/supabase-env.test.ts tests/auth-redirects.test.ts tests/auth-callback-route.test.ts`; Pass: `npm run supabase -- db push --linked --yes`; Pass: `npm run supabase -- migration list --linked`; Pass: `npm run agents:check`; Pass: `npm run resolvers:check`; Pass: `npm run lint`; Pass: `npm run typecheck`; Pass: `npm run test`; Pass: `npm run build`; Browser QA: hosted Google OAuth from `http://localhost:3000` completed and redirected to `/behaviors`; authenticated create/edit/archive flow passed against hosted Supabase; active behavior moved to Archived with preserved history; 390px mobile viewport had no horizontal overflow. | Start Ticket 006: Occurrence generation. Local Supabase OAuth still needs its Google redirect URI updated if local Google OAuth is used. |
| 006: Occurrence generation | complete | Added pure occurrence generation planning for the rolling today + 30 day local-date window; added Supabase occurrence repository/service orchestration; wired behavior create/edit/archive to sync occurrences; idempotent inserts use `behavior_id, scheduled_for`; stale future unresolved rows are removed while past and resolved rows are preserved. Widened the recurrence resolver range input to accept `Temporal.Instant` as well as `Date`. | Pass: `npx vitest run tests/occurrence.resolver.test.ts tests/recurrence.resolver.test.ts`; Pass: `npm run agents:check`; Pass: `npm run resolvers:check`; Pass: `npm run lint`; Pass: `npm run typecheck`; Pass: `npm run test`; Pass: `npm run build`. | Ticket 007 complete; start Ticket 008: Status marking and notes. |
| 007: Timeline | complete | Added pure Timeline grouping resolver and tests; added timeline service and occurrence repository reads; replaced `/timeline` placeholder with Needs decision, current day, future day sections, show-more control, empty-day states, resolved-state styling, and expandable occurrence details. Status mutation and note editing remain for Ticket 008. Updated `DESIGN.md` from the implemented Timeline UI. | Pass: `npx vitest run tests/timeline.resolver.test.ts`; Pass: `npm run agents:check`; Pass: `npm run resolvers:check`; Pass: `npm run lint`; Pass: `npm run typecheck`; Pass: `npm run test`; Pass: `npm run build`; Browser QA: `/timeline` authenticated render at 1280px and 390px, no horizontal overflow, Needs decision/current/future empty states visible, show-more control visible on mobile. | Start Ticket 008: Status marking and notes. |
| 008: Status marking and notes | complete | Added pure status transition and note normalization resolver; added occurrence repository/service update path; added Timeline server actions; replaced disabled Timeline buttons with live Completed / Not Completed controls; added inline expanded note editing; resolved rows can change status later from expanded details. | Pass: `npx vitest run tests/status.resolver.test.ts tests/timeline.resolver.test.ts`; Pass: `npm run resolvers:check`; Pass: `npm run lint`; Pass: `npm run agents:check`; Pass: `npm run typecheck`; Pass: `npm run test`; Pass: `npm run build`; Browser QA: in-app browser `/timeline` redirected unauthenticated session to `/login` with no console errors. Authenticated Timeline visual QA was not possible because the in-app browser did not have a Supabase session, and Chrome fallback was not used without explicit approval. | Start Ticket 009: Browser push. Reminder cancellation on status resolution remains for the reminder-service tickets, where deliveries are generated and processed. |
| 009: Browser push | complete | Added reminder delivery resolver/tests; created reminder delivery repository/service and wired occurrence sync to create missing browser/email delivery rows from behavior reminder settings; resolving an occurrence cancels pending deliveries. Added authenticated push subscription API route, service validation, and repository upsert. Replaced Settings placeholder with profile, timezone, notification permission, and browser push availability panels plus a client enable/save control. Added minimal push service worker display/click handling without offline/PWA caching. Updated `DESIGN.md` from the implemented Settings UI and `docs/ROUTE_MAP.md` for the implemented Settings/API route state. No schema migration was needed because `push_subscriptions` and `reminder_deliveries` already existed. | Pass: `npx vitest run tests/reminder.resolver.test.ts tests/push-subscribe-route.test.ts tests/push-browser.test.ts`; Pass: `npm run agents:check`; Pass: `npm run resolvers:check`; Pass: `npm run lint`; Pass: `npm run typecheck`; Pass: `npm run test`; Pass: `npm run build`; Browser QA: in-app browser `/settings` authenticated render at 1280px and 390px, no horizontal overflow, no console errors. Local degraded-state QA showed permission `Blocked` and missing `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, so the real browser permission prompt/subscription handshake was not clicked in this environment. | Start Ticket 010: Email reminders. Configure `NEXT_PUBLIC_VAPID_PUBLIC_KEY` for real browser subscription testing; keep VAPID private/server keys out of browser code. |
| 010: Email reminders | complete | Added a `processing_started_at` claim migration and regenerated Supabase types; extended the existing reminder repository/service to list, claim, cancel, mark sent, and mark failed due email deliveries; added a server-only Sequenzy transactional template adapter; added protected `POST /api/reminders/process`; stale pending email deliveries are cancelled when the behavior is inactive, email reminders are disabled, the occurrence is resolved, or the current resolver-planned offset no longer matches. Runtime uses `SUPABASE_SERVICE_ROLE_KEY`, `REMINDER_PROCESS_SECRET`, `SEQUENZY_API_KEY`, and `SEQUENZY_REMINDER_TEMPLATE_SLUG` only on the server side. Provider setup uses transactional slug `habit-reminder`, and local `.env.local` sets `SEQUENZY_REMINDER_TEMPLATE_SLUG=habit-reminder`. Hosted Supabase migration `20260608011000_add_reminder_delivery_processing_claim.sql` has been pushed. | Pass: `npm run supabase -- db reset`; Pass: `./node_modules/.bin/supabase gen types typescript --local > lib/db/database.types.ts`; Pass: `npm run test -- tests/reminder.resolver.test.ts tests/reminder.service.test.ts tests/reminder-process-route.test.ts tests/sequenzy.service.test.ts`; Pass: `npm run agents:check`; Pass: `npm run resolvers:check`; Pass: `npm run lint`; Pass: `npm run typecheck`; Pass: `npm run test`; Pass: `npm run build`; Pass: `npm run sequenzy -- whoami` with `.env.local` loaded; Pass: `npm run sequenzy -- transactional get habit-reminder --json`; Pass: one user-approved historical test send to a recipient now redacted from the working tree (the address remains in Git history); Pass: `npm run supabase -- db push --linked --yes`; Pass: `npm run supabase -- migration list --linked` shows local and remote `20260608011000`. | Start Ticket 011: Analytics. Set `REMINDER_PROCESS_SECRET` in the deployed/server runtime before scheduling calls to `/api/reminders/process`; do not expose it to the browser. |
| 011: Analytics | complete | Added pure analytics resolver/types/tests; added analytics service orchestration over existing behavior and occurrence repositories; replaced `/analytics` with a sparse server-rendered screen containing overall adherence, 7/30/90 range links, an overall calendar heatmap, selected-day Not Completed inspection, per-behavior counts and heatmaps, and compact category counts. Updated `docs/ROUTE_MAP.md` and `DESIGN.md` from the implemented screen. | Pass: `npx vitest run tests/analytics.resolver.test.ts`; Pass: `npm run agents:check`; Pass: `npm run resolvers:check`; Pass: `npm run lint`; Pass: `npm run typecheck`; Pass: `npm run test`; Pass: `npm run build`; Browser QA: in-app browser `/analytics` redirected unauthenticated session to `/login?next=%2Fanalytics` at 1280px and 390px with no horizontal overflow and no console errors. Authenticated Analytics visual QA was not possible because the in-app browser did not have a Supabase session. | Start Ticket 012: Export. No Ticket 011 blockers. |
| 012: Export | complete | Added pure export resolver/types/tests; added export service orchestration over categories, behaviors, occurrences, and profile timezone; added `/api/export/jsonl`, `/api/export/csv`, and `/api/export/json` download routes; replaced `/export` placeholder with range options, Include archived behaviors, download actions, and Markdown AI summary copy/download controls. JSONL emits category, behavior, and occurrence records one per line; CSV uses the documented occurrence columns with escaping; full JSON backup includes `exported_at`, profile timezone, categories, behaviors, and occurrences; Markdown adherence excludes unresolved occurrences. Updated `docs/ROUTE_MAP.md` and `DESIGN.md` from the implemented screen. | Pass: `npx vitest run tests/export.resolver.test.ts`; Pass: `npm run agents:check`; Pass: `npm run resolvers:check`; Pass: `npm run lint`; Pass: `npm run typecheck`; Pass: `npm run test`; Pass: `npm run build`; Browser QA: authenticated in-app browser `/export` rendered at 1280px and 390px with no horizontal overflow, no console warnings/errors, expected download links, and all-time plus archived query option state preserved. | No Ticket 012 blockers. Future restore/import history remains out of scope unless product docs change. |
| 013: Vercel production deployment | complete | Added `vercel.json` with hourly Vercel Cron for `/api/reminders/process`; updated the route to support Vercel Cron `GET` plus existing protected manual `POST`; added `CRON_SECRET` support alongside `REMINDER_PROCESS_SECRET`; documented Vercel workflow, env ownership, Supabase Auth redirects, smoke QA, and rollback path. Later browser-push troubleshooting and production verification completed the original push-subscription/send blocker. | Pass: `npm run test -- tests/reminder-process-route.test.ts`; Pass: `npm run agents:check`; Pass: `npm run resolvers:check`; Pass: `npm run lint`; Pass: `npm run typecheck`; Pass: `npm run test`; Pass: `npm run build`; production smoke for login/protected redirects/authenticated app routes; production cron logs returned 200; Chrome verified notification permission plus active FCM PushSubscription; safe production browser-push send returned `{ checked: 1, claimed: 1, sent: 1, failed: 0, cancelled: 0 }`. | No Ticket 013 blocker remains. Chrome will not show the native notification permission prompt again for an origin that is already granted or denied unless site settings are reset. Actual file download events remain limited by browser automation, but Export page/link rendering was verified. |

Later ticket rollup:

| Ticket | Status | Current note |
|---|---|---|
| 014: BehaviorLog import validation dry-run | complete | Service/resolver dry-run validation exists; no import writes were added in this ticket. |
| 015: BehaviorLog core conformance harness | complete | Cadence-generated BehaviorLog bundles pass the pinned upstream Level 1 validator snapshot; future changes should update the snapshot intentionally. |
| 016: BehaviorLog Level 2 CSV views | complete | Optional BehaviorLog CSV views are emitted from authoritative JSONL and covered by resolver/conformance tests. |
| 017: BehaviorLog Intervention Profile export | complete | Reminder deliveries export as optional Intervention Profile records without provider side effects or message-body export. |
| 018: BehaviorLog import persistence foundation | complete | Import-run and mapping tables exist with RLS and hosted migration applied. |
| 019: BehaviorLog create-only core import | complete | Create-missing-only behavior/schedule/occurrence/status-event import path exists and remains non-destructive. |
| 020: BehaviorLog conflict-aware merge preview | complete | Merge preview produces deterministic actions/conflicts without mutating product data. |
| 021: BehaviorLog user-approved merge write | complete | Approved merge writes create/map records and append status events without blind overwrite or destructive restore. |
| 022: BehaviorLog optional notes import | complete | Occurrence-attached note import was implemented and later expanded by Ticket 026. |
| 023: BehaviorLog Intervention Profile import preview | complete | Optional intervention import preview was implemented and later expanded by Ticket 027. |
| 024: User-facing BehaviorLog import UI | complete | Export screen includes upload, preview, recent-run, create-only, and approved-merge UI. |
| 025A: BehaviorLog restore preview | complete | Added a preview-only restore resolver/service contract with create/replace/archive/delete/keep/skip action classification, destructive-action flags, non-restorable account/provider/browser fields, status-history policy planning, sensitivity/redaction summaries, stable local/bundle/preview fingerprints, a `restore_preview` import-run mode migration, and focused tests. No product records, reminder deliveries, provider calls, or destructive apply behavior were added. Hosted migration `20260619090000_add_behaviorlog_restore_preview_mode.sql` has been pushed. | Pass: `npm run test -- tests/behaviorlog-restore.resolver.test.ts tests/behaviorlog-restore.service.test.ts`; Pass: `npm run supabase -- db reset`; Pass: `./node_modules/.bin/supabase gen types typescript --local > lib/db/database.types.ts` (no generated type diff); Pass: `npm run agents:check`; Pass: `npm run resolvers:check`; Pass: `npm run lint`; Pass: `npm run typecheck`; Pass: `npm run test` (37 files, 247 tests); Pass: `npm run build`; Pass: `git diff --check`; later hosted push/migration-list verification recorded in the Web App Performance Speed Loop ledger. | None for hosted preview schema. |
| 025B: BehaviorLog restore apply and UI | complete | Added a destructive restore apply path behind accepted restore preview/fingerprint checks, typed `RESTORE` confirmation, fresh-backup acknowledgement, sensitivity acknowledgement when relevant, stale-preview refusal, a transaction-scoped Supabase RPC, and sparse Export-screen restore UI. Restore apply is limited to user-owned BehaviorLog product data and does not call Sequenzy, Web Push, browser APIs, provider SDKs, or notification-processing routes. Hosted migration `20260619093000_add_behaviorlog_restore_apply_mode_and_rpc.sql` has been pushed, followed by corrective migration `20260625220756_fix_behaviorlog_restore_apply_rpc.sql` and internal function hardening migration `20260625221334_harden_internal_function_permissions.sql`. | Pass: `npm run test -- tests/behaviorlog-restore-ui.test.tsx tests/behaviorlog-restore-apply.service.test.ts tests/behaviorlog-restore.resolver.test.ts tests/behaviorlog-restore.service.test.ts tests/behaviorlog-import-ui.test.tsx`; Pass: `npm run supabase -- db reset`; Pass: `./node_modules/.bin/supabase gen types typescript --local > lib/db/database.types.ts`; Pass: `npm run agents:check`; Pass: `npm run resolvers:check`; Pass: `npm run lint`; Pass: `npm run typecheck`; Pass: `npm run test` (39 files, 251 tests); Pass: `npm run build`; Pass: `npm run design-system:check`; Pass: `git diff --check`; Browser QA on `/design-system#ds-module-behavior-log-restore-panel` at 1280px and 390px with no horizontal overflow or console warnings/errors; later hosted schema probes verified the restore RPC conflict target and execute permissions. | Destructive restore was not applied against a real account during QA. Current apply expects Cadence/UUID core identifiers for core restore rows and does not recreate categories from BehaviorLog bundles. |
| 026: General BehaviorLog notes data model and import | complete | Passive imported notes table and import/apply support are implemented with sensitivity acknowledgement. |
| 027: Imported intervention history storage | complete | Passive imported intervention history storage exists with RLS and hosted migration applied. |
| 028: Promote imported interventions into reminder deliveries | complete | Service-level promotion path exists with explicit selection/confirmation; no user-facing promotion UI has been added. |
| 029: Public web hardening account safety baseline | complete | Account deletion, legal/trust pages, endpoint hardening, bounded reminder processing, and RLS policy registry are implemented. Remaining public-launch follow-up is hosted multi-user RLS smoke QA, first-run onboarding, and privacy-conscious monitoring/error reporting. |
| 030: Public web hardening follow-up | complete | Added dismissible Timeline first-run setup, privacy-safe structured runtime monitoring, and `npm run smoke:rls` many-user RLS smoke QA. | Pass: `npm run smoke:rls`; Pass: `npm run agents:check`; Pass: `npm run resolvers:check`; Pass: `npm run lint`; Pass: `npm run typecheck`; Pass: `npm run test` (35 files, 241 tests); Pass: `npm run build`; Pass: `npm run design-system:check`; Pass: `git diff --check`; Browser QA with a temporary authenticated Chrome user verified Timeline first-run setup at 1280px and 390px with no horizontal overflow, required links present, no console warnings/errors, and temporary user cleanup. | No Ticket 030 blocker remains. Re-run `npm run smoke:rls` before broad launch and after material RLS/schema changes. |
| 061: Export prompt library for external AI analysis | complete | Added twelve static, provider-generic analysis prompts after the Export AI summary, with typed shared semantics, native disclosure rows, format/option requirements, and clipboard feedback. The library is UI-only and does not change export artifacts. |
| 062: Interaction audit P3 traceability and narrow-screen follow-up | complete | Closed locally actionable IA-025 through IA-028: exact registry labels, complete marketing source ownership, honest direct/indirect/manual coverage, 320px Settings containment, and stale deployment-ledger reconciliation. IA-024 remains product-decision-gated. |

## Post-ticket refinements

### Desktop rail expansion navigation fix (2026-07-28)

Status: complete.

Implementation summary:
- Reproduced the recorded request: the collapsed desktop brand cell expanded
  the rail and navigated to Timeline as one combined interaction.
- Split the header behavior by rail state. Expanded mode keeps the Cadence
  brand link to Timeline and the separate Collapse navigation button.
  Collapsed mode now renders an Expand navigation button with no `href` and no
  navigation side effect.
- Preserved the 64px target, persisted `sidebar-open` preference, Cadence-mark
  to open-sidebar-icon hover treatment, width transition, primary route icons,
  mobile navigation, and expanded brand navigation.
- Updated `components/layout/AppShell.tsx`, the focused shell and registry-label
  tests, `interaction-registry.json`, the design-system preview/catalog,
  `DESIGN.md`, `docs/UI_SPEC.md`, `docs/USER_FLOWS.md`, and the task-based app
  navigation guide.
- No route, schema, resolver, provider, authentication, or product-data
  behavior changed.

Verification:
- Pass: `npm run test -- tests/sign-out-shell.test.tsx tests/interaction-registry-labels.test.ts`
  (2 files, 10 tests).
- Pass: `npm run agents:check` (106 invariants).
- Pass: `npm run interactions:check` (4299 invariants, 85 interactions, 34
  interaction sources).
- Pass: `npm run resolvers:check` (159 invariants).
- Pass: `npm run design-system:check`.
- Pass: `npm run lint`.
- Pass: `npm run typecheck`.
- Pass: `npm run test` (87 files, 564 tests).
- Pass: `npm run build`.
- Pass: `git diff --check`.
- Browser QA: the live AppShell design-system preview exposed one Collapse
  navigation control while expanded and one Expand navigation control while
  collapsed. Expanding restored the separate Open Timeline brand link without
  changing the current URL. No browser warnings or errors appeared.
- Pass: isolated clean-tree verification for production commit
  `c8c92b3bcd18522eaa1e2d5859a3b3469f5c34d7`: agent, interaction, resolver,
  design-system, focused shell, lint, typecheck, full test (81 files, 542
  tests), and production build checks.
- Pass: Vercel production deployment
  `dpl_DLJRWazbUqznKhXyC8F2ZSK2qVCV` reached `READY` and assigned the canonical
  `https://cadence-blush-three.vercel.app` alias.
- Pass: authenticated production browser QA at `/export`. Expanding the
  collapsed rail kept the URL on `/export`, restored the separate Open Timeline
  link to `/timeline`, and exposed the Collapse navigation control. Vercel
  reported no `/export` runtime errors in the selected post-deploy window.

Remaining risk:
- No sidebar deployment blocker remains. The production build completed with
  an existing Ink/React peer-dependency warning; it did not prevent the build
  or the authenticated live smoke.

### Hosted July schema deployment and occurrence-status recovery (2026-07-13)

Status: complete.

Implementation summary:
- Diagnosed production occurrence status failures as application/schema drift:
  Vercel was running the RPC-based Ticket 058 code while hosted Supabase still
  lacked `apply_occurrence_status_transition`.
- Applied the four already-reviewed pending migrations in timestamp order:
  accepted import-preview binding, behavior definition history, transactional
  occurrence status changes, and atomic/idempotent BehaviorLog restore apply.
- Restored hosted schema compatibility for occurrence status changes, behavior
  create/edit, accepted import apply, and restore apply without changing
  product scope or manually editing hosted product rows outside migrations.

Verification:
- Pass: `npm run supabase -- db push --linked --dry-run` listed exactly the four
  expected July migrations.
- Pass: authorized `npm run supabase -- db push --linked --yes` applied
  migrations through
  `20260709203154_make_behaviorlog_restore_atomic_and_idempotent.sql`.
- Pass: `npm run supabase -- migration list --linked` confirmed local/hosted
  parity through `20260709203154`.
- Pass: `npm run supabase -- db advisors --linked --type all --fail-on error`
  returned no error-level findings. Warnings remain for the intentional
  authenticated restore wrappers, leaked-password protection, and pre-existing
  RLS initialization-plan performance findings.
- Pass: focused status, behavior-definition, and restore migration/repository
  tests (7 files, 63 tests).
- Pass: `npm run agents:check` (95 invariants).
- Pass: `npm run resolvers:check` (152 invariants).
- Pass: `npm run lint`.
- Pass: `npm run typecheck`.
- Pass: `npm run test` (67 files, 429 tests).
- Pass: `npm run build`.
- Pass: `git diff --check`.
- Blocked environment check: `npm run smoke:rls` could not reach Supabase from
  the sandbox, and the requested escalated retry was rejected before execution;
  no temporary users were created by that retry.

Remaining risk:
- A real authenticated production status click was not performed during this
  deployment task to avoid adding synthetic status history to a personal
  account. Retry the affected Timeline action as the final user-path smoke.
- The repository should add a production migration-parity preflight so a
  schema-dependent application deployment cannot become ready while matching
  hosted migrations are pending.

### Behaviors browser-comment alignment follow-up (2026-07-12)

Status: complete.

Implementation summary:
- Widened the desktop Overall adherence summary column so the label and short
  percentage stay on one adjacent line, while long empty-state text can wrap as
  a complete metric without colliding with the calendar.
- Right-aligned the range-selector, overall heatmap, and legend cluster against
  the content edge.
- Matched visible per-behavior outcome stats to the Details and Settings
  metadata rhythm at a 4px row gap and 20px line height.
- Raised Add schedule so it sits 8px below the schedule rows.
- Preserved conditional recurrence controls: Daily does not show weekday
  choices, while Weekly shows all seven borderless native checkboxes. Added a
  static-render regression test for both states.
- Updated `docs/UI_SPEC.md` and `DESIGN.md` to replace the stale opposite-side
  adherence-percentage rule with the adjacent header and right-aligned calendar
  direction.

Verification:
- Pass: `npm run agents:check` (95 invariants).
- Pass: `npm run resolvers:check` (152 invariants).
- Pass: `npm run design-system:check`.
- Pass: `npm run lint`.
- Pass: `npm run typecheck`.
- Pass: `npm run test -- tests/behavior-review-ui.test.tsx` (4 tests).
- Pass: isolated rerun of `tests/behavior-actions.test.ts` after its initial
  concurrent full-suite run hit the existing 5-second timeout.
- Pass: standalone `npm run test` (67 files, 429 tests).
- Pass: `npm run build`.
- Browser QA: authenticated local `/behaviors` at 1024x768 confirmed one-line
  adherence label/percentage layout, a 12px label/percentage gap, 0px
  visualization right inset, seven Weekly checkbox controls, an 8px
  schedule-row/Add schedule gap, no horizontal overflow, and no browser errors.
- Browser QA: fixture-backed active behavior data confirmed visible and hidden
  detail lists both use a 4px row gap and 20px line height. Authenticated local
  `/behaviors` at 390x844 and `/timeline` at 1280x720 also rendered without
  horizontal overflow, error overlays, or warning/error logs.

Remaining risk:
- The refinement is verified locally but has not been deployed to hosted
  production yet.

### Behaviors browser-comment spacing refinement (2026-07-12)

Status: complete.

Implementation summary:
- Tightened the Overall adherence label-to-percentage gap and narrowed the
  visualization column so the range selector, heatmap, and legend sit farther
  right at desktop widths while preserving the stacked mobile order.
- Reduced the behavior-row bottom padding and disclosure trigger height so
  Details and Settings sits closer to the stats/calendar without taking the
  expanding underline out of document flow.
- Removed the expanded-details top padding, reduced metadata row spacing and
  line height, and kept the editor separated from the compact metadata block.
- Replaced the bordered weekday checkbox chips with compact borderless labels
  around the existing native checkboxes, and updated `DESIGN.md` to make that
  intentional product direction explicit.
- Removed the overlapping-occurrences helper sentence from the form. Resolver
  deduplication behavior and coverage remain unchanged.

Verification:
- Pass: `npm run agents:check` (95 invariants).
- Pass: `npm run resolvers:check` (152 invariants).
- Pass: `npm run design-system:check`.
- Pass: `npm run lint`.
- Pass: `npm run typecheck`.
- Pass: `npm run test` (67 files, 428 tests).
- Pass: `npm run build`.
- Browser QA: authenticated local `/behaviors` at 1024x768 confirmed a 12px
  adherence label/percentage gap, a right-aligned visualization column, no
  horizontal overflow, and no browser warnings or errors.
- Browser QA: authenticated local `/behaviors` at 390x844 confirmed all seven
  weekday labels use 0px borders and 32px compact minimum heights, the helper
  sentence is absent, the settled document width matches the viewport, and no
  browser warnings or errors appeared. The fixture-backed BehaviorList preview
  additionally confirmed 0px expanded-content top padding, a 4px metadata row
  gap, and 20px metadata line height.

Remaining risk:
- The refinement is verified locally but has not been deployed to hosted
  production yet.

### Marketing homepage critique fixes (2026-07-12)

Status: complete.

Implementation summary:
- Ran the project Impeccable critique on the marketing homepage, which scored
  28/40 with three P1 findings.
- Fixed the mobile hero clipping risk and flat H1/H2 scale, completed the
  banned-pattern copy pass, replaced the icon-card grid with one ledger panel,
  and removed border-plus-shadow pairs and monospace-as-costume styling.
- Resized the Cadence logo assets, removed the unused oversized hero export,
  and codified the marketing register exceptions in `DESIGN.md`.

Verification:
- Pass: `npm run marketing:build`.
- Pass: `node scripts/check-agent-readability.mjs` from `apps/marketing`.
- Pass: Impeccable detector returned `[]` for the homepage and base layout.
- Pass: generated homepage HTML and Markdown contain no em dash characters.
- Pass: `npm run design-system:check`.

### Analytics summary unresolved alignment

Status: complete.

Implementation summary:
- Updated the Analytics top summary Unresolved count to match the Timeline Needs decision count.
- The top summary now counts only active unresolved occurrences before the current local day, regardless of the selected Analytics range.
- Current-day unresolved occurrences still appear in the Analytics heatmap and behavior/category detail counts so the current-day state remains visible.
- Added `behaviorActive` to analytics resolver input from the analytics service so archived prior unresolved occurrences do not affect the top summary count.
- Updated product/UI/user-flow/design docs to document the aligned summary semantics.
- No schema changes, route changes, provider operations, or out-of-scope features were added.

Verification:
- Pass: `npm run test -- tests/analytics.resolver.test.ts tests/timeline.resolver.test.ts`
- Pass: `npm run resolvers:check`
- Pass: `npm run typecheck`
- Pass: `npm run agents:check`
- Pass: `npm run lint`
- Pass: `npm run test` (25 files, 157 tests).
- Pass: `npm run build`
- Browser QA: authenticated in-app browser `/analytics` showed summary `Unresolved: 0` while `/timeline` showed `Open Needs decision, 0 prior unresolved occurrences`; `/analytics` had no browser warning/error logs.

Remaining risk:
- Behavior/category detail counts may still show current-day unresolved occurrences by design; only the top summary Unresolved count is aligned to Needs decision.

### Analytics calendar completion intensity

Status: complete.

Implementation summary:
- Updated the overall Analytics calendar from a binary completed/not-completed treatment to completion-intensity day cells.
- Overall day cells now carry `completionRate`; fully completed days use the full completed color, partial days mix the completed color with the background by completed share, and days with no completions use the background end of the scale without a diagonal overlay.
- Added the `partial` overall day state in the analytics resolver/type contract and updated resolver tests for a 50% completed day.
- Updated the Analytics legend, design-system Analytics fixture, product/UI/user-flow/design docs, and browser QA coverage for the new shade-only visual semantics.
- No schema changes, route changes, provider operations, or out-of-scope features were added.

Verification:
- Pass: `npm run test -- tests/analytics.resolver.test.ts`
- Pass: `npm run resolvers:check`
- Pass: `npm run typecheck`
- Pass: `npm run design-system:check`
- Pass: `python3 /Users/emi/.codex/skills/design-system-bench/scripts/scan_inventory.py --root . --out /tmp/cadence-design-system.manifest.json`
- Pass: `python3 /Users/emi/.codex/skills/design-system-bench/scripts/scan_usages.py --root . --manifest design-system.manifest.json --out /tmp/cadence-design-system.usage.json`
- Pass: `python3 /Users/emi/.codex/skills/design-system-bench/scripts/verify_traceability.py --root . --manifest design-system.manifest.json --usage design-system.usage.json --bench app/design-system/page.tsx`
- Pass: `npm run agents:check`
- Pass: `npm run lint`
- Pass: `npm run test` (25 files, 157 tests).
- Pass: `npm run build`
- Browser QA: authenticated in-app browser `/analytics` showed live fractional `data-completion-rate` values, proportional computed blue shades, the Partial legend item, zero diagonal overlays in the overall calendar and legend, no horizontal overflow at desktop or 390px mobile, and no browser warnings/errors.
- Browser QA: `/design-system` at 390px showed the partial Analytics fixture cell, no horizontal overflow, and no browser warnings/errors.

Remaining risk:
- Fully unresolved days intentionally remain neutral; unresolved occurrences reduce a mixed day's completion shade because the shade represents completion share across all scheduled occurrences for that day. A 0% completed resolved day is intentionally the background end of the shade scale.

### Analytics layout simplification and tracking starts

Status: complete.

Implementation summary:
- Removed boxed section-panel treatment from the Analytics screen and converted the page to unboxed report sections separated by horizontal dividers.
- Merged the overall calendar into the Overall adherence area and moved the calendar legend behind a See Legend disclosure.
- Removed the empty selected-day Not Completed panel; selected-day Not Completed details now render only when the selected day has rows.
- Added per-behavior tracking start metadata from `behaviors.created_at`, converted through Temporal in the behavior timezone, and surfaced it as Tracking since text plus a start marker in each behavior heatmap when the start day is in range.
- Reshaped behavior and category status counts into vertical label/value rows with numeric values aligned to the right.
- Updated Analytics resolver tests, the design-system Analytics fixture, product/UI/user-flow/design docs, and this status ledger.
- No schema changes, route changes, provider operations, or out-of-scope features were added.

Verification:
- Pass: `npm run test -- tests/analytics.resolver.test.ts`
- Pass: `./node_modules/.bin/eslint components/analytics/AnalyticsScreen.tsx lib/resolvers/analytics.resolver.ts lib/services/analytics.service.ts tests/analytics.resolver.test.ts app/design-system/page.tsx`
- Pass: `npm run typecheck`
- Pass: `npm run design-system:check`
- Pass: `npm run resolvers:check`
- Pass: `python3 /Users/emi/.codex/skills/design-system-bench/scripts/scan_inventory.py --root . --out /tmp/cadence-design-system.manifest.json`
- Pass: `python3 /Users/emi/.codex/skills/design-system-bench/scripts/scan_usages.py --root . --manifest design-system.manifest.json --out /tmp/cadence-design-system.usage.json`
- Pass: `python3 /Users/emi/.codex/skills/design-system-bench/scripts/verify_traceability.py --root . --manifest design-system.manifest.json --usage design-system.usage.json --bench app/design-system/page.tsx`
- Pass: `git diff --check`
- Pass: `npm run agents:check`
- Pass: `npm run lint`
- Pass: `npm run test` (25 files, 158 tests).
- Pass: `npm run build`
- Browser QA: authenticated in-app browser `/analytics` at desktop width showed zero boxed section wrappers, the calendar inside Overall adherence, See Legend closed by default and revealing the legend on click, no empty selected-day Not Completed panel, Tracking since text and `data-tracking-start` cells for behavior rows, label/value status rows, no horizontal overflow, and no warning/error logs.
- Browser QA: authenticated in-app browser `/analytics` at 390px showed zero boxed section wrappers, no horizontal overflow, no empty selected-day Not Completed panel, behavior count values to the right of their labels, Tracking since text and start markers, and See Legend closed by default.

Remaining risk:
- The visible heatmap start marker is intentionally subtle and relies on the adjacent Tracking since text for human-readable context.

### Timeline mobile adaptation

Status: complete.

Implementation summary:
- Adapted the Timeline mobile layout while preserving the desktop ledger treatment.
- Kept occurrence rows unboxed and kept native disclosure without adding a chevron or separate disclosure icon.
- Moved mobile status actions into a full-width touch row before expanded details, increased mobile status and note action tap targets, made grouped stacks breathe more on mobile, and adapted the Needs decision button/modal for mobile safe areas.
- Browser-comment follow-up removed the mobile divider between the occurrence time/title row and the Completed/Not Completed action row while preserving the mobile touch row spacing.
- Updated `docs/UI_SPEC.md`, `docs/USER_FLOWS.md`, and `DESIGN.md` so the mobile Timeline behavior and no-chevron choice are documented.
- Updated `design-system.usage.json` Timeline line references for the restructured occurrence row.
- No schema, resolver, provider, reminder, export, analytics, or out-of-scope product behavior changes were added.

Verification:
- Pass: `npm run agents:check`
- Pass: `npm run resolvers:check`
- Pass: `npm run lint`
- Pass: `npm run typecheck`
- Pass: `npm run test` (19 files, 115 tests).
- Pass: `npm run build`
- Pass: `npm run design-system:check`
- Pass: `python3 /Users/emi/.codex/skills/design-system-bench/scripts/scan_inventory.py --root . --out /tmp/cadence-design-system.manifest.json`
- Pass: `python3 /Users/emi/.codex/skills/design-system-bench/scripts/scan_usages.py --root . --manifest design-system.manifest.json --out /tmp/cadence-design-system.usage.json`
- Pass: `python3 /Users/emi/.codex/skills/design-system-bench/scripts/verify_traceability.py --root . --manifest design-system.manifest.json --usage design-system.usage.json --bench app/design-system/page.tsx`
- Browser QA: `/design-system` at 390px width reported no horizontal overflow; closed occurrence details were hidden; the first status action measured 44px tall; expanding the occurrence row showed details as a grid with the status row before details and no chevron text detected; browser logs showed no warnings or errors.
- Follow-up pass: `npm run agents:check`; `npm run resolvers:check`; `./node_modules/.bin/eslint components/timeline/OccurrenceRow.tsx`; `npm run test` (19 files, 115 tests); `npm run design-system:check`; `git diff --check -- components/timeline/OccurrenceRow.tsx`.
- Follow-up browser QA: `/timeline` at 430px wide reported `statusBorderTopWidth: "0px"` for the occurrence status row and no horizontal overflow.
- Follow-up unblock: after regenerating `lib/db/database.types.ts` during BehaviorLog milestone verification, full `npm run lint`, `npm run typecheck`, and `npm run build` passed again.

Remaining risk:
- The in-app browser did not open the fixed Needs decision modal from the design-system bench trigger despite the trigger being visible and no console errors being present, so modal open/close interaction was not verified in browser QA during this pass.

### Behaviors page critique follow-up

Status: complete.

Implementation summary:
- Completed all priority fixes from the Behaviors page impeccable critique.
- Worker 1 changed `/behaviors` so the create form sits behind a native disclosure, stays closed when existing behaviors are present, and opens by default only for a no-behavior empty state.
- Worker 2 changed `BehaviorList` so per-card edit forms lazy-mount only after the card's edit disclosure is opened.
- Added a first-class Restore action for archived behaviors through the existing server action/service/repository path; Restore sets `active=true`, clears `archived_at`, and re-syncs occurrences.
- Improved segmented radio focus visibility for schedule and recurrence controls.
- Tightened behavior copy from "Schedule times" to "Scheduled for", "Every N days" to "Every few days", and recurrence unit labels to singular/plural text without `day(s)`-style wording.
- Updated `docs/UI_SPEC.md`, `docs/USER_FLOWS.md`, and `DESIGN.md` to reflect the collapsed create form, lazy edit pattern, and Restore affordance.
- No schema changes, resolver changes, provider operations, or out-of-scope product features were added.

Verification:
- Pass: Worker 1 `npm run typecheck`.
- Pass: Worker 2 `npm run typecheck`; `npm run agents:check`; `npm run resolvers:check`; `npm run lint`; `npm run test`; `npm run build`.
- Pass: `npm run typecheck`.
- Pass: `npm run agents:check`.
- Pass: `npm run resolvers:check`.
- Pass: `npm run lint`.
- Pass: `npm run test` (18 files, 103 tests).
- Pass: `npm run design-system:check`.
- Pass: `python3 /Users/emi/.codex/skills/design-system-bench/scripts/scan_inventory.py --root . --out /tmp/cadence-design-system.manifest.json`.
- Pass: `python3 /Users/emi/.codex/skills/design-system-bench/scripts/scan_usages.py --root . --manifest design-system.manifest.json --out /tmp/cadence-design-system.usage.json`.
- Pass: `python3 /Users/emi/.codex/skills/design-system-bench/scripts/verify_traceability.py --root . --manifest design-system.manifest.json --usage design-system.usage.json --bench app/design-system/page.tsx`.
- Pass: `npm run build`.
- Browser QA: authenticated in-app browser `/behaviors` desktop render showed create disclosure closed, Active and Archived sections present, 8 Archive buttons, 3 Restore buttons, no horizontal overflow, and 0 mounted edit forms while cards were closed.
- Browser QA: opening one behavior edit disclosure mounted exactly 1 edit form, showed "Every few days", showed "Scheduled for", and confirmed focus-styled segmented labels were present.
- Browser QA: authenticated in-app browser `/behaviors` at 390px width showed the Active behaviors heading near the top of the viewport, create disclosure closed, 8 Archive buttons, 3 Restore buttons, no horizontal overflow, and 0 mounted edit forms while cards were closed.

Remaining risk:
- Restore was verified through render-level browser QA and build/type checks; a live database restore click was not performed to avoid changing the user's behavior data during QA.

### Behavior schedule slots

Status: complete.

Implementation summary:
- Added exact-time and preset time-range schedule slots for behaviors, including multiple slots per behavior.
- Added migration `20260609202707_add_behavior_schedule_slots.sql` with `behavior_schedule_slots`, occurrence schedule snapshot fields, RLS policies, and backfill from existing `behaviors.scheduled_time`.
- Updated behavior form parsing/UI, behavior repositories/services, occurrence generation, reminder email variables, Timeline grouping, analytics labels, export formats, generated database types, docs, and tests.
- Timeline grouping keeps each scheduled time/range as its own occurrence row, avoids progress-fill grouped rows, avoids "1 of 2 completed" labels, and keeps partial completion as a derived visual result only.

Verification:
- Pass: `npm run supabase -- db reset`
- Pass: `./node_modules/.bin/supabase gen types typescript --local > lib/db/database.types.ts`
- Pass: `npm run test -- tests/behavior-form.test.ts tests/occurrence.resolver.test.ts tests/timeline.resolver.test.ts tests/analytics.resolver.test.ts tests/export.resolver.test.ts tests/reminder.resolver.test.ts tests/reminder.service.test.ts`
- Pass: `npm run typecheck`
- Pass: `npm run design-system:check`
- Pass: `python3 /Users/emi/.codex/skills/design-system-bench/scripts/scan_inventory.py --root . --out /tmp/cadence-design-system.manifest.json`
- Pass: `python3 /Users/emi/.codex/skills/design-system-bench/scripts/scan_usages.py --root . --manifest design-system.manifest.json --out /tmp/cadence-design-system.usage.json`
- Pass: `python3 /Users/emi/.codex/skills/design-system-bench/scripts/verify_traceability.py --root . --manifest design-system.manifest.json --usage design-system.usage.json --bench app/design-system/page.tsx`
- Pass: `npm run agents:check`
- Pass: `npm run resolvers:check`
- Pass: `npm run lint`
- Pass: `npm run test`
- Pass: `npm run build`
- Browser QA: `/design-system` desktop fixture render shows the new schedule editor, range cues, grouped Timeline range rows, no "1 of 2 completed" label, no horizontal overflow, and no bench-specific warning/error logs observed beyond the earlier authenticated route error already noted below.
- Browser QA: `/design-system` at 390px width shows the new schedule editor, range cues, grouped Timeline range rows, no "1 of 2 completed" label, and no horizontal overflow.

Remaining risk:
- Authenticated `/behaviors` and `/timeline` render against the configured hosted Supabase database will fail until the new migration is deployed to hosted Supabase. Hosted `db push` was not run because it requires explicit user authorization.

### Timeline Needs decision modal

Status: complete.

Implementation summary:
- Replaced the inline Needs decision section on `/timeline` with a fixed lower-right Needs decision button and modal.
- The button shows the current prior-unresolved occurrence count and uses the primary visual treatment when there are decisions pending.
- The modal renders the same resolver-produced Needs decision day groups and occurrence rows, preserving Completed, Not Completed, and Note actions without duplicating timeline grouping logic.
- Updated `docs/PRODUCT_SPEC.md`, `docs/UI_SPEC.md`, `docs/USER_FLOWS.md`, `docs/ROUTE_MAP.md`, and `DESIGN.md` so the source of truth matches the modal-based interaction.

Verification:
- Pass: `npm run agents:check`
- Pass: `npm run resolvers:check`
- Pass: `npm run lint`
- Pass: `npm run typecheck`
- Pass: `npm run test`
- Pass: `npm run build`
- Browser QA: authenticated in-app browser `/timeline` desktop render shows no inline Needs decision section, shows the fixed lower-right count button, and reports no console warnings or errors.
- Browser QA: authenticated in-app browser `/timeline` at 390px width has no horizontal overflow, no inline Needs decision section, and the fixed count button remains within the viewport.

Remaining risk:
- The active browser-comment overlay in the in-app browser inserted `#codex-browser-sidebar-comments-root` above the page with pointer events enabled. This blocked click/key event delivery for all client toggles tested, including the existing mobile navigation button, so modal open/close interaction could not be verified in that annotated browser surface.

### Design system bench adoption

Status: complete.

Implementation summary:
- Added a local/dev-only `/design-system` bench route that renders existing product UI components with static fixture data. The route is outside primary navigation, calls no Supabase services, and returns `notFound()` in production builds.
- Added required foundation and primitive sections for typography, font scale, color, spacing, radius, border, shadow, motion, and common product control patterns.
- Added trace cards for 18 tracked UI entries, including the app shell, screen frame, primary navigation registry, login button, Timeline, Behaviors, Analytics, Export, Settings, and supporting Timeline/Behavior/Export modules.
- Added `design-system.config.json`, `design-system.manifest.json`, `design-system.usage.json`, and `scripts/check-design-system.mjs`; `npm run design-system:check` is separate from the existing required checks.
- Added the short `design-system-bench` routing hook to `AGENTS.md` and documented the internal route in `docs/ROUTE_MAP.md`.

Verification:
- Pass: `npm run design-system:check`
- Pass: post-bench temporary inventory and usage rescans; `app/design-system` did not enter inventory or product usage, and usage summary stayed at 25 product usages / 0 bench previews.
- Pass: `npm run agents:check`
- Pass: `npm run resolvers:check`
- Pass: `npm run lint`
- Pass: `npm run typecheck`
- Pass: `npm run test`
- Pass: `npm run build`
- Browser QA: `http://localhost:3000/design-system` desktop render showed 18 trace cards, required foundation anchors, closed usage drawers, no horizontal overflow, and no browser console warnings or errors.
- Browser QA: `http://localhost:3000/design-system` at 390px width showed 18 trace cards, the Needs decision product preview control, no horizontal overflow, and no browser console warnings or errors.

Remaining risk:
- A Next dev server was already running on port 3000 during QA. The bench was verified through that server; no server restart was performed.

### Quiet border system

Status: complete.

Implementation summary:
- Replaced product UI `border-2` and color-specific border treatments with the shared 1px `border-line` quiet divider across the app shell, auth, Timeline, Behaviors, Analytics, Export, Settings, and design-system previews.
- Updated the `/design-system` Border foundation so controls and panels use the same quiet divider instead of documenting a separate 2px major-border style.
- Updated `DESIGN.md` so the source-of-truth visual system now defines one 1px Ash Line border rule for product dividers, controls, panels, rows, inputs, overlays, and heatmap cells.

Verification:
- Pass: `npm run design-system:check`
- Pass: design-system-bench inventory and usage rescans to temporary files; auto inventory omitted the existing manual navigation entry, usage summary stayed at 25 product usages / 0 bench previews.
- Pass: `npm run agents:check`
- Pass: `npm run resolvers:check`
- Pass: `npm run lint`
- Pass: `npm run typecheck`
- Pass: `npm run test`
- Pass: `npm run build`
- Browser QA: `http://localhost:3000/design-system` desktop render showed both Border foundation samples at 1px with the same `border-line` color, no horizontal overflow, and no browser warning/error logs.
- Browser QA: `http://localhost:3000/design-system` at 390px width showed both Border foundation samples at 1px with the same `border-line` color, no horizontal overflow, and no browser warning/error logs.

Remaining risk:
- A Next dev server was already running on port 3000 during QA. The bench was verified through that server; no server restart was performed.

### Courier New typography stack

Status: complete.

Implementation summary:
- Replaced the product font family stack in `app/globals.css` with `Courier New` for the Tailwind `font-sans`, Tailwind `font-mono`, and body font declarations.
- Updated the `/design-system` Typography foundation row and product preview wrapper so the bench displays and computes `Courier New` instead of the previous Courier/Courier New/monospace stack.
- Updated `DESIGN.md` so the design-system source of truth names `Courier New` as the single product font family.

Verification:
- Pass: `npm run design-system:check`
- Pass: design-system-bench inventory and usage rescans to temporary files; usage summary stayed at 25 product usages / 0 bench previews.
- Pass: `python3 /Users/emi/.codex/skills/design-system-bench/scripts/verify_traceability.py --root . --manifest design-system.manifest.json --usage design-system.usage.json --bench app/design-system/page.tsx`
- Pass: `npm run agents:check`
- Pass: `npm run resolvers:check`
- Pass: `npm run lint`
- Pass: `npm run typecheck`
- Pass: `npm run test`
- Pass: `npm run build`
- Browser QA: `http://localhost:3000/design-system` desktop render showed `Font family: Courier New`, computed the Typography row and product preview as `"Courier New"`, had no horizontal overflow, and reported no browser warning/error logs.
- Browser QA: `http://localhost:3000/design-system` at 390px width showed `Font family: Courier New`, computed the row as `"Courier New"`, had no horizontal overflow, and reported no browser warning/error logs.

Remaining risk:
- A Next dev server was already running on port 3000 during QA. The bench was verified through that server; no server restart was performed.

### Timeline status refresh

Status: complete.

Implementation summary:
- Updated `components/timeline/StatusButtons.tsx` to call `router.refresh()` after a successful status server action.
- The server action still owns persistence and calls `revalidatePath("/timeline")`; the refresh only asks the current route to consume the fresh resolver-produced Timeline payload.
- Preserved the existing Needs decision semantics: the floating button and modal count prior-day unresolved occurrences only.

Verification:
- Pass: `npm run agents:check`
- Pass: `npm run resolvers:check`
- Pass: `npm run lint`
- Pass: `npm run typecheck`
- Pass: `npm run test`
- Pass: `npm run build`
- Pass: `npm run design-system:check`
- Pass: design-system-bench inventory and usage rescans to temporary files; usage summary stayed at 25 product usages / 0 bench previews.
- Pass: `python3 /Users/emi/.codex/skills/design-system-bench/scripts/verify_traceability.py --root . --manifest design-system.manifest.json --usage design-system.usage.json --bench app/design-system/page.tsx`
- Browser QA: read-only authenticated `/timeline` render showed the floating Needs decision button count and open modal count both at `3`, no horizontal overflow, and no browser warning/error logs.

Remaining risk:
- Browser QA did not click a real Completed or Not Completed button because that would mutate the user's actual behavior history.
- Current-day completions do not reduce the Needs decision count by design; that count is derived only from unresolved occurrences before the current local date.

### IBM Plex Sans typography stack

Status: complete.

Implementation summary:
- Added the Next.js `IBM_Plex_Sans` font to `app/layout.tsx` and applied both its generated body class and CSS variable at the root layout.
- Updated `app/globals.css` so the Tailwind `font-sans`, Tailwind `font-mono`, and body font declarations use IBM Plex Sans with standard sans fallbacks.
- Updated the `/design-system` Typography foundation row and product preview wrapper so the bench displays and computes `IBM Plex Sans`.
- Updated `DESIGN.md` so the design-system source of truth names IBM Plex Sans as the single product font family.
- Restarted the existing local `next dev` server on port 3000 after browser QA found a stale generated Tailwind CSS chunk from the prior Courier New stack.

Verification:
- Pass: `npm run agents:check`
- Pass: `npm run resolvers:check`
- Pass: `npm run lint`
- Pass: `npm run typecheck`
- Pass: `npm run test`
- Pass: `npm run build`
- Pass: `npm run design-system:check`
- Pass: design-system-bench inventory and usage rescans to temporary files; usage summary stayed at 25 product usages / 0 bench previews.
- Pass: `python3 /Users/emi/.codex/skills/design-system-bench/scripts/verify_traceability.py --root . --manifest design-system.manifest.json --usage design-system.usage.json --bench app/design-system/page.tsx`
- Browser QA: `http://localhost:3000/design-system` desktop render showed `Font family: IBM Plex Sans`; body, Typography row, product preview, and the first `font-mono` usage computed to IBM Plex Sans; no horizontal overflow; no browser warning/error logs.
- Browser QA: `http://localhost:3000/design-system` at 390px width showed `Font family: IBM Plex Sans`; body, Typography row, product preview, and the first `font-mono` usage computed to IBM Plex Sans; no horizontal overflow; no browser warning/error logs.

Remaining risk:
- Historical `STATUS.md` entries still describe the prior Courier New work, but live source and current design docs now use IBM Plex Sans.

### Fixed sidebar and unframed behavior form

Status: complete.

Implementation summary:
- Updated `components/layout/AppShell.tsx` so the desktop sidebar is truly fixed while page content scrolls, with the main content padded by the expanded or collapsed sidebar width.
- Narrowed the collapsed desktop sidebar to a 64px icon rail, centered the expand/collapse button with the nav icons, and removed boxed borders around sidebar navigation items.
- Removed the outer border and padding from the Behaviors page Create behavior section while preserving the form controls and inner field-group dividers.
- Updated `docs/UI_SPEC.md`, `DESIGN.md`, and the design-system bench navigation preview/usage metadata so the source-of-truth and trace files match the new UI treatment.

Verification:
- Pass: `npm run design-system:check`
- Pass: `npm run agents:check`
- Pass: `npm run resolvers:check`
- Pass: `npm run lint`
- Pass: `npm run typecheck`
- Pass: `npm run test`
- Pass: `npm run build`
- Pass: design-system-bench classify/theme detection plus inventory and usage rescans to temporary files; auto inventory omitted only the existing manual navigation entry, and usage summary stayed at 25 product usages / 0 bench previews.
- Pass: `python3 /Users/emi/.codex/skills/design-system-bench/scripts/verify_traceability.py --root . --manifest design-system.manifest.json --usage design-system.usage.json --bench app/design-system/page.tsx`
- Browser QA: authenticated `/behaviors` at 1024x768 showed fixed expanded sidebar metrics, `main` left padding at 288px, sidebar nav item borders at `0px`, and the Create behavior section with `0px` border and `0px` padding.
- Browser QA: authenticated `/behaviors` collapsed at 1024x768 showed a 64px fixed sidebar, `main` left padding at 64px, expand/collapse button and all nav icons centered at the same x coordinate, and nav item borders at `0px`.
- Browser QA: `/behaviors` at 390px showed no horizontal overflow; the mobile drawer opened to 288px, kept nav item borders at `0px`, and stayed within the viewport.
- Browser QA: authenticated `/timeline` at 1024x768 after scrolling showed the sidebar fixed at top `0`, `main` left padding at 288px, no horizontal overflow, and nav item borders at `0px`.

Remaining risk:
- The `/timeline` browser QA route took one slow first render during local dev before the layout metrics were collected; the measured layout state passed after the page loaded.
- After resetting the temporary browser viewport, local dev Supabase auth fetches began timing out and the cleanup navigation landed on `/login?next=%2Fbehaviors`; the authenticated `/behaviors` and `/timeline` layout checks had already completed.

### Behavior form timezone removal and recurrence flattening

Status: complete.

Implementation summary:
- Removed the Timezone display panel from the Behavior create/edit form; timezone remains owned by Settings and is still applied server-side from the profile/default timezone during behavior creation.
- Removed the Recurrence editor's outer bordered panel while preserving its semantic fieldset, segmented recurrence presets, and weekday/monthly controls.
- Changed Recurrence subsection labels such as Every, On, and Day to smaller muted heading text.
- Tightened the desktop sidebar from 288px to 256px expanded and from 64px to 56px collapsed, with matching main-content offsets.
- Updated `docs/UI_SPEC.md`, `DESIGN.md`, the design-system bench preview usage, and design-system trace metadata to match the new form and shell treatment.

Verification:
- Pass: `npm run design-system:check`
- Pass: `npm run agents:check`
- Pass: `npm run resolvers:check`
- Pass: `npm run lint`
- Pass: `npm run typecheck`
- Pass: `npm run test`
- Pass: `npm run build`
- Pass: design-system-bench classify/theme detection plus inventory and usage rescans to temporary files; auto inventory omitted only the existing manual navigation entry, and usage summary stayed at 25 product usages / 0 bench previews.
- Browser QA: authenticated `/behaviors` at 1024x768 showed a fixed 256px sidebar, `main` left padding at 256px, no timezone block in the form, a 0px border/0px padding Recurrence fieldset, and no horizontal overflow.
- Browser QA: authenticated `/behaviors` collapsed at 1024x768 showed a 56px sidebar, `main` left padding at 56px, and the expand/collapse button plus all nav icons centered on the same x coordinate.
- Browser QA: authenticated `/behaviors` at 390px showed no horizontal overflow, no timezone block, and a 0px border/0px padding Recurrence fieldset.
- Browser QA: authenticated `/timeline` at 1024x768 after scrolling showed the sidebar fixed at top `0`, a 256px sidebar width, `main` left padding at 256px, and no horizontal overflow.

Remaining risk:
- Local dev-server logs showed transient Supabase DNS/auth fetch failures before browser QA, but the server recovered and authenticated `/behaviors` and `/timeline` layout QA completed successfully.

### Reminder editor flattening

Status: complete.

Implementation summary:
- Updated `components/behaviors/ReminderEditor.tsx` so the Reminders fieldset uses the same unframed form-section treatment as Recurrence, with no outer border or padding.
- Changed the Reminder offset label to the smaller muted subsection-heading style.
- Updated `docs/UI_SPEC.md` and `DESIGN.md` so Reminders, Recurrence, and the Behavior form source-of-truth describe the same unframed pattern.
- While verifying, aligned the existing in-progress schedule-slot work with TypeScript by updating generated database types for the existing `behavior_schedule_slots` migration, schedule-slot service/test fixtures, design-system preview fixtures, analytics/export test fixtures, and behavior/export mapping fixtures.

Verification:
- Pass: `npm run design-system:check`
- Pass: `npm run agents:check`
- Pass: `npm run resolvers:check`
- Pass: `npm run lint`
- Pass: `npm run typecheck`
- Pass: `npm run test`
- Pass: `npm run build`
- Pass: `python3 /Users/emi/.codex/skills/design-system-bench/scripts/verify_traceability.py --root . --manifest design-system.manifest.json --usage design-system.usage.json --bench app/design-system/page.tsx`
- Browser QA: `/design-system` desktop render showed the live Reminders fieldset at `0px` border and `0px` padding, matching Recurrence, with Reminder offset at 12px bold label text and no horizontal overflow.
- Browser QA: `/design-system` at 390px width showed the Reminders fieldset at `0px` border and `0px` padding with no horizontal overflow.

Remaining risk:
- Authenticated `/behaviors` browser QA is currently blocked by the connected Supabase schema/cache returning `PGRST200` for the `behaviors` to `behavior_schedule_slots` relationship. The migration and docs exist locally, but the connected database was not updated in this task because hosted schema deployment requires explicit authorization.

### Hosted schedule-slot schema deployment and embed repair

Status: complete.

Implementation summary:
- Pushed hosted Supabase migration `20260609202707_add_behavior_schedule_slots.sql`, bringing the connected remote schema back in line with local migrations.
- Confirmed the hosted schema now has `behavior_schedule_slots` and occurrence schedule snapshot columns.
- Fixed `lib/db/behaviors.repo.ts` to embed `schedule_slots` through the explicit owner-scoped `behavior_schedule_slots_behavior_owner_fkey` relationship, resolving PostgREST `PGRST201` ambiguity after the schema migration was deployed.
- Triggered a production Vercel redeploy with empty commit `c9989b8` (`chore: trigger Vercel redeploy`) before making the code repair, then verified deployment `dpl_F7zEzJBMshqwAA6DkJRHSUus6u4R` reached `READY`.

Verification:
- Pass: `npm run supabase -- db push --linked --yes`
- Pass: `npm run supabase -- migration list --linked`
- Pass: remote Supabase probe for `behavior_schedule_slots`, occurrence schedule columns, and explicit behavior schedule-slot embed
- Pass: unauthenticated local `/timeline` redirects to `/login?next=%2Ftimeline`
- Pass: authenticated in-app browser `/timeline` renders without the runtime overlay or warning/error logs
- Pass: `npm run agents:check`
- Pass: `npm run resolvers:check`
- Pass: `npm run lint`
- Pass: `npm run typecheck`
- Pass: `npm run test`
- Pass: `npm run build`

Remaining risk:
- None known for the hosted schedule-slot schema and behavior schedule-slot embed issue.

### Timeline completion chime

Status: complete.

Implementation summary:
- Added the user-provided MP3 as `public/sounds/completion-chime.mp3`.
- Added client-side completion feedback so `StatusButtons` preloads the chime and plays it only after a successful user-initiated status change into Completed.
- Kept Not Completed, note saves, page refreshes, and re-saving an already Completed occurrence silent.
- Follow-up: changed playback to fetch the MP3 during preload, create/resume the browser audio context during the user's submit gesture, and play the decoded chime only after the status server action reports success. This addresses browser policies that can block first-click audio when `play()` is called only after the async save returns.
- Documented the chime behavior in `docs/UI_SPEC.md` and `DESIGN.md`.
- Added `lib/ui/completion-feedback.ts` and paired tests for the completion-chime decision rule.
- Updated the design-system bench preview to pass the existing `restoreAction` prop required by the in-progress BehaviorList work, and excluded non-rendering `lib/ui/**` helpers from auto-inventory scans.

Verification:
- Pass: `npm run agents:check`
- Pass: `npm run resolvers:check`
- Pass: `npm run lint`
- Pass: `npm run typecheck`
- Pass: `npm run test`
- Pass: `npm run build`
- Pass: `npm run design-system:check`
- Pass: `npm run test -- tests/completion-feedback.test.ts`
- Pass: design-system-bench classify/theme detection plus inventory and usage rescans to temporary files; inventory stayed focused on 18 rendered components and did not retain the audio helper as a visual module after config exclusion.
- Pass: `curl -I http://localhost:3000/sounds/completion-chime.mp3` returned `200 OK` with `Content-Type: audio/mpeg`.
- Browser QA: authenticated in-app browser `/timeline` desktop render showed Completed controls, no horizontal overflow, and no warning/error logs.
- Browser QA: authenticated in-app browser `/timeline` at 390px width showed Completed controls, no horizontal overflow, and no warning/error logs.
- Follow-up Browser QA: local `/design-system#ds-module-status-buttons` rendered the fixture Completed button and reported no warning/error logs, but its server-action mock did not submit in the in-app browser fixture; no product data was changed.

Remaining risk:
- Browser QA did not click a real Completed button because that would mutate the user's actual behavior history. The client decision rule is covered by tests, and the audio asset route is verified.

### Timeline Not Completed approval controls

Status: complete.

Implementation summary:
- Updated the Timeline resolver display metadata so `not_completed` occurrences expose the same collapsed Completed / Not Completed controls as an unresolved decision row, with Not Completed indicated as the current choice.
- Completed rows continue to use the full blue resolved treatment and collapsed status label instead of primary buttons.
- Updated the Timeline UI source-of-truth docs and design-system occurrence-row fixture so Not Completed rows are documented and previewed as approval-ready, without adding a new stored status or changing Needs decision semantics.

Verification:
- Pass: `npm run test -- tests/timeline.resolver.test.ts`
- Pass: `npm run agents:check`
- Pass: `npm run resolvers:check`
- Pass: `npm run lint`
- Pass: `npm run typecheck`
- Pass: `npm run test`
- Pass: `npm run build`
- Pass: `npm run design-system:check`
- Pass: design-system-bench classify/theme detection, inventory and usage scans to temporary files, and `python3 /Users/emi/.codex/skills/design-system-bench/scripts/verify_traceability.py --root . --manifest design-system.manifest.json --usage design-system.usage.json --bench app/design-system/page.tsx`
- Browser QA: authenticated in-app browser `/timeline` default-width render showed the selected Not Completed row with collapsed Completed and Not Completed buttons, Not Completed `aria-pressed="true"`, Completed rows still label-only, no horizontal overflow, and no browser warning/error logs.
- Browser QA: authenticated in-app browser `/timeline` at 390px width showed the same Not Completed collapsed controls, no horizontal overflow, and no browser warning/error logs.

Remaining risk:
- Browser QA did not click the status buttons because that would mutate the user's actual behavior history. The resolver display contract is covered by `tests/timeline.resolver.test.ts`.

### Timeline Not Completed original surface

Status: complete.

Implementation summary:
- Updated `components/timeline/OccurrenceRow.tsx` so `not_completed` rows use the same `bg-background` collapsed card surface and `bg-surface` expanded-detail surface as the original unresolved row.
- Preserved the prior behavior where `not_completed` rows expose both collapsed Completed and Not Completed buttons, with Not Completed indicated as the current choice.
- Confirmed no schema migration is needed: the existing `occurrences` row already stores `status`, `completed_at`, and `status_marked_at` per scheduled occurrence instance.
- Updated `docs/UI_SPEC.md`, `docs/USER_FLOWS.md`, and `DESIGN.md` to call this a visual reset while preserving the stored `not_completed` status on the occurrence instance.

Verification:
- Pass: `npm run agents:check`
- Pass: `npm run resolvers:check`
- Pass: `npm run lint`
- Pass: `npm run typecheck`
- Pass: `npm run test`
- Pass: `npm run build`
- Pass: `npm run design-system:check`
- Pass: design-system-bench classify/theme detection, inventory and usage scans to temporary files, and `python3 /Users/emi/.codex/skills/design-system-bench/scripts/verify_traceability.py --root . --manifest design-system.manifest.json --usage design-system.usage.json --bench app/design-system/page.tsx`
- Browser QA: authenticated in-app browser `/timeline` default-width render showed Not Completed rows on `bg-background` with collapsed Completed and Not Completed buttons, no horizontal overflow, and no browser warning/error logs.
- Browser QA: authenticated in-app browser `/timeline` at 390px width showed the 9:00 AM Not Completed row on `bg-background` with both buttons, no horizontal overflow, and no browser warning/error logs.

Remaining risk:
- Browser QA did not click status buttons because that would mutate the user's actual behavior history. No data-model risk is known for this visual treatment change.

### Font scale downshift

Status: complete.

Implementation summary:
- Shifted the app's Tailwind text scale down one step at the shared token level in `app/globals.css`; existing `text-*` utilities now render smaller across product UI and product previews.
- Updated the `/design-system` Font scale foundation to show Display 30, Heading 24, Section 20, Body 14, and Label 12 with matching computed sizes.
- Updated `DESIGN.md` so the typography source of truth matches the implemented scale.
- During verification, fixed a hook dependency warning in `components/timeline/StatusButtons.tsx` and a lint-only `this` alias in `tests/completion-feedback.test.ts` from the existing completion-chime worktree changes.

Verification:
- Pass: `python3 /Users/emi/.codex/skills/design-system-bench/scripts/classify_repo.py --root .`
- Pass: `python3 /Users/emi/.codex/skills/design-system-bench/scripts/detect_theme_support.py --root .`
- Pass: `npm run design-system:check`
- Pass: `python3 /Users/emi/.codex/skills/design-system-bench/scripts/scan_inventory.py --root . --out /tmp/cadence-design-system.manifest.json`
- Pass: `python3 /Users/emi/.codex/skills/design-system-bench/scripts/scan_usages.py --root . --manifest design-system.manifest.json --out /tmp/cadence-design-system.usage.json`
- Pass: `npm run agents:check`
- Pass: `npm run resolvers:check`
- Pass: `npm run lint`
- Pass: `npm run typecheck`
- Pass: `npm run test -- tests/completion-feedback.test.ts`
- Pass: `npm run test` (18 files, 106 tests).
- Pass: `npm run build`
- Browser QA: `/design-system` at 1042x863 showed the Font scale foundation with computed sizes Display 30, Heading 24, Section 20, Body 14, and Label 12; no horizontal overflow.
- Browser QA: `/design-system` at 390x844 showed the same computed font-scale values, no horizontal overflow, and no browser warning/error logs.

Remaining risk:
- The change was verified on the design-system bench and fixture-backed product previews. Authenticated product-route click flows were not exercised because this was a shared typography-token change and should not mutate user data.

### No-bold typography experiment

Status: complete.

Implementation summary:
- Added shared font-weight token overrides in `app/globals.css` so Tailwind weight utilities from `font-medium` through `font-black` render at normal `400` weight.
- Added native-element resets for headings, semantic bold text, table headers, definition terms, and summaries so browser defaults do not reintroduce bolding.
- Updated `DESIGN.md` so the typography contract describes all hierarchy levels at `400` weight and notes that this is a no-bold experiment.

Verification:
- Pass: `python3 /Users/emi/.codex/skills/design-system-bench/scripts/classify_repo.py --root .`
- Pass: `python3 /Users/emi/.codex/skills/design-system-bench/scripts/detect_theme_support.py --root .`
- Pass: `npm run design-system:check`
- Pass: `python3 /Users/emi/.codex/skills/design-system-bench/scripts/scan_inventory.py --root . --out /tmp/cadence-design-system.manifest.json`
- Pass: `python3 /Users/emi/.codex/skills/design-system-bench/scripts/scan_usages.py --root . --manifest design-system.manifest.json --out /tmp/cadence-design-system.usage.json`
- Pass: `npm run agents:check`
- Pass: `npm run resolvers:check`
- Pass: `npm run lint`
- Pass: `npm run typecheck`
- Pass: `npm run test` (18 files, 107 tests).
- Pass: `npm run build`
- Browser QA: `/design-system` at desktop width showed bench chrome and Font scale samples all computed at `font-weight: 400`; no horizontal overflow.
- Browser QA: authenticated `/timeline` at desktop width showed sampled title, nav, button, section heading, and body text all computed at `font-weight: 400`; no horizontal overflow.
- Browser QA: authenticated `/timeline` at 390x844 showed sampled mobile brand, menu button, page title, section heading, and body text all computed at `font-weight: 400`; no horizontal overflow and no warning/error logs.

Remaining risk:
- This is intentionally a broad visual experiment. It preserves existing component class names, so future reversion can remove the shared token overrides without editing every component.

### Completion chime diagnostics follow-up

Status: complete.

Implementation summary:
- Diagnosed the completion chime path after reports that Completed did not trigger sound.
- Confirmed `/sounds/completion-chime.mp3` is served locally as `audio/mpeg`; the remaining likely causes were browser activation timing after async server actions, loss of submitted status intent, transient preload failure caching, and embedded-browser media API gaps.
- Changed `StatusButtons` so Completed and Not Completed are submitted through separate structural forms with hidden `occurrence_id` and `status` fields instead of relying on `SubmitEvent.submitter`.
- The status server action now echoes the submitted status in `OccurrenceActionState`; `StatusButtons` uses that server-confirmed status after success while still priming audio on pointer/click/submit before the async action returns.
- Further hardened `StatusButtons` so it captures the submitted status and current status at the user gesture, then requires a successful server-confirmed `completed` result before playback. A later render cannot cause a chime without that captured user intent.
- Split the media-element gesture primer from the media element used for audible playback so delayed muted-primer cleanup cannot pause, reset, or mute the real chime.
- Hardened `lib/ui/completion-feedback.ts` to prime Web Audio with a silent one-sample source, unlock an `HTMLAudioElement` during the user gesture, prefer the media element for actual audible playback, keep Web Audio as fallback, retry failed preload/decode attempts, guard missing `AudioContext`/`Audio` APIs, and emit dev-only playback/blocked diagnostics.
- Added a final compatibility fallback for browsers where media playback rejects and the MP3 buffer cannot load or decode: when Web Audio oscillator/gain nodes are available and the context can run, Cadence now plays one very short, low-gain synthesized chime before reporting playback blocked.
- Changed the Timeline refresh sequence so `router.refresh()` waits until the chime playback path has started instead of immediately refreshing after the successful status action.
- Follow-up production listener QA showed two real production Completed clicks reached hydrated React status forms, but neither emitted `cadence:completion-chime-played` nor `cadence:completion-chime-blocked`. The issue was the status server action calling `revalidatePath("/timeline")` before the client success effect could run; completing an occurrence can remove or replace the submitting action component, losing the pending chime effect.
- Removed the eager Timeline revalidation from `markOccurrenceStatusAction`. `StatusButtons` already refreshes the Timeline after success and completion feedback, so server confirmation is preserved while avoiding the unmount race.
- Production deployment `dpl_HJXgLVV75HTFGbGVY6YYbpVMRywF` from commit `a7f824221aabbc3b756b08a426f447efa0d3b02f` was ready and aliased to `https://cadence-blush-three.vercel.app` on 2026-06-19.
- Updated the design-system fixture action to mirror the real status action's `nextStatus` return for fixture-backed browser QA.
- No schema, resolver, product-scope, notification-provider, or real occurrence-data changes were made.

Verification:
- Pass: `curl -I http://localhost:3000/sounds/completion-chime.mp3` returned `200 OK` with `Content-Type: audio/mpeg`.
- Pass: `curl -I http://localhost:3002/sounds/completion-chime.mp3` returned `200 OK` with `Content-Type: audio/mpeg` from the current Cadence dev server.
- Pass: `ffprobe`/`ffmpeg` diagnostics after installing `ffmpeg`: asset is a 1-second stereo MP3, peak `-2.7 dB`, RMS `-25.1 dB`, with audible content before the trailing silence.
- Pass: `afplay public/sounds/completion-chime.mp3` exited successfully.
- Pass: `npm run test -- tests/completion-feedback.test.ts` (14 tests covering intent confirmation, primer/playback separation, synthesized fallback success, and oscillator-unavailable blocked coverage).
- Pass: `npx eslint components/timeline/StatusButtons.tsx lib/ui/completion-feedback.ts tests/completion-feedback.test.ts`
- Pass: `npm run agents:check`
- Pass: `npm run resolvers:check`
- Pass: `npm run lint`
- Pass: `npm run design-system:check`
- Pass: `npm run typecheck`
- Pass: `npm run test` (32 files, 227 tests).
- Pass: `npm run build`
- Pass: Production Chrome listener attached to `https://cadence-blush-three.vercel.app/timeline` captured two user-clicked Completed submits with `status: "completed"` and hydrated React `onPointerDown`/`onClick`/`onSubmit` handlers present, but no chime played/blocked events before the local fix.
- Pass: `npm run test -- tests/completion-feedback.test.ts` after removing eager status-action revalidation.
- Pass: `npm run typecheck`
- Pass: `npm run agents:check`
- Pass: `npm run resolvers:check`
- Pass: `npm run lint`
- Pass: `npm run test` (32 files, 227 tests).
- Pass: `npm run build`
- Pass: Vercel production deployment `dpl_HJXgLVV75HTFGbGVY6YYbpVMRywF` reached `READY`, with canonical alias `cadence-blush-three.vercel.app` and commit `a7f824221aabbc3b756b08a426f447efa0d3b02f`.
- Pass: Production smoke after deploy: `/login` returned 200; `/timeline`, `/behaviors`, `/settings`, `/analytics`, and `/export` redirected unauthenticated requests to `/login?next=...`; `/api/reminders/process` returned 401 without a secret; `/sounds/completion-chime.mp3` returned 200 with `Content-Type: audio/mpeg`.
- Pass: Vercel runtime logs showed no production warning/error/fatal entries in the 15 minutes around the deployment smoke check.
- Pass: design-system-bench classify/theme detection, inventory and usage scans to `/tmp`, and `npm run design-system:check`; a freshly generated full traceability verification still reports unrelated in-progress Settings/Timezone bench coverage gaps from the current dirty worktree, so no design-system source files were changed for this chime-only pass.
- Browser QA: Chrome remote-debugging profile loaded local `/design-system#ds-module-status-buttons`, clicked the fixture Completed control through CDP mouse events, received the bench server-action success message, and observed `cadence:completion-chime-played` with `source: "media"`.
- Browser QA: After the eager-revalidation fix, Chrome loaded local `http://localhost:3002/design-system#ds-module-status-buttons`, clicked the fixture Completed control, and observed `cadence:completion-chime-played` with `source: "media"`.
- Browser QA: in-app browser `/design-system#ds-module-status-buttons` rendered Completed and Not Completed controls and the fixture action completed without mutating product data. The in-app browser reports `AudioContext`, `Audio`, and `Notification` as unavailable, so it cannot prove audible playback in that embedded surface.
- Browser QA: Chrome plugin fresh tab `/design-system#ds-module-status-buttons` clicked Completed and logged `cadence:completion-chime-played media`, confirming the normal browser media element playback path started. The only observed Chrome warning was an extension-injected hydration mismatch, unrelated to audio.
- Browser QA: Chrome design-system `NotificationPermissionPanel` preview showed the `Permission` row, `Browser push` row, and `Enable browser reminders` control. The fixture has no VAPID key, so the control was disabled and no permission prompt was opened or accepted.
- Browser QA: in-app browser `NotificationPermissionPanel` preview showed the `Permission` row and `Enable browser reminders` control, with permission blocked/unavailable in that embedded surface.

Remaining risk:
- The in-app browser cannot play or authorize audio because its media and notification APIs are unavailable; Chrome verified the actual media playback-start path.
- The synthesized compatibility fallback is covered by unit tests only. The real Chrome fixture used the preferred media element path, so the fallback was not forced in browser QA.
- Browser notification permission prompts were not accepted during QA. The permission label/control is present, and prompt triggering remains owned by Settings with real push configuration.

### Timeline status action text links

Status: complete.

Implementation summary:
- Changed `components/timeline/StatusButtons.tsx` so Timeline Completed and Not Completed actions render as inline text-link controls instead of boxed filled/outlined buttons, while retaining the check and x icons.
- Kept semantic submit buttons under the hood so keyboard access, form submission, pending state, `aria-pressed`, and completion chime preparation remain intact.
- Updated `docs/UI_SPEC.md`, `docs/USER_FLOWS.md`, and `DESIGN.md` so future Timeline work preserves text-link status actions instead of reintroducing button chrome.
- No schema, resolver, service, API route, provider, or product-scope changes were made.

Verification:
- Pass: `npm run agents:check`
- Pass: `npm run resolvers:check`
- Pass: `npm run lint`
- Pass: `npm run typecheck`
- Pass: `npm run test` (18 files, 107 tests).
- Pass: `npm run design-system:check`
- Pass: `python3 /Users/emi/.codex/skills/design-system-bench/scripts/classify_repo.py --root .`
- Pass: `python3 /Users/emi/.codex/skills/design-system-bench/scripts/detect_theme_support.py --root .`
- Pass: `python3 /Users/emi/.codex/skills/design-system-bench/scripts/scan_inventory.py --root . --out /tmp/cadence-design-system.manifest.json`
- Pass: `python3 /Users/emi/.codex/skills/design-system-bench/scripts/scan_usages.py --root . --manifest design-system.manifest.json --out /tmp/cadence-design-system.usage.json`
- Pass: `python3 /Users/emi/.codex/skills/design-system-bench/scripts/verify_traceability.py --root . --manifest design-system.manifest.json --usage design-system.usage.json --bench app/design-system/page.tsx`
- Pass: `npm run build`
- Browser QA: authenticated in-app browser `/timeline` desktop render showed Completed and Not Completed controls with transparent background, `0px` border width, retained icons, current-choice underline where applicable, and no warning/error logs.
- Browser QA: authenticated in-app browser `/timeline` at 390px width showed the text-link status actions wrapping without horizontal overflow and no warning/error logs.

Remaining risk:
- Browser QA did not click status actions because that would mutate the user's actual occurrence history. The existing fixture-backed StatusButtons path remains covered by the design-system bench.

### Timeline borderless row polish

Status: complete.

Implementation summary:
- Removed perimeter borders from Timeline occurrence rows and tightened row rhythm with a 4px list gap plus compact 10-12px row padding.
- Removed the Timeline page helper sentence under the title.
- Removed the border from the mobile top-bar navigation icon button.
- Removed the internal divider between the number and text in the floating Needs decision button while keeping its outer button affordance.
- Updated `docs/UI_SPEC.md`, `docs/USER_FLOWS.md`, `DESIGN.md`, and the local design-system typography preview so the documented visual direction matches the implemented Timeline.
- No schema, resolver, service, API route, provider, or product-scope changes were made.

Verification:
- Pass: `npm run agents:check`
- Pass: `npm run resolvers:check`
- Pass: `npm run lint`
- Pass: `npm run typecheck`
- Pass: `npm run test` (18 files, 107 tests).
- Pass: `npm run design-system:check`
- Pass: `python3 /Users/emi/.codex/skills/design-system-bench/scripts/scan_inventory.py --root . --out /tmp/cadence-design-system.manifest.json`
- Pass: `python3 /Users/emi/.codex/skills/design-system-bench/scripts/scan_usages.py --root . --manifest design-system.manifest.json --out /tmp/cadence-design-system.usage.json`
- Pass: `python3 /Users/emi/.codex/skills/design-system-bench/scripts/verify_traceability.py --root . --manifest design-system.manifest.json --usage design-system.usage.json --bench app/design-system/page.tsx`
- Pass: `npm run build`
- Browser QA: authenticated in-app browser `/timeline` at 942px width showed no Timeline helper text, occurrence row border widths at `0px`, list `rowGap: 4px`, row padding at `12px`, mobile menu trigger border widths at `0px`, Needs decision count span border widths at `0px`, no horizontal overflow, and no warning/error logs.
- Browser QA: authenticated in-app browser `/timeline` at 390px width showed no Timeline helper text, occurrence row border widths at `0px`, list `rowGap: 4px`, row padding at `10px`, mobile menu trigger border widths at `0px`, Needs decision count span border widths at `0px`, no horizontal overflow, and no warning/error logs.

Remaining risk:
- Browser QA was visual/read-only. Status actions and the Needs decision modal were not clicked to avoid mutating the user's live occurrence history.

### Timeline status action underline affordance

Status: complete.

Implementation summary:
- Changed `components/timeline/StatusButtons.tsx` so all Timeline status text-link actions are underlined by default.
- Follow-up: normalized Completed and Not Completed action underlines to the same thin `decoration-1` treatment so Not Completed no longer receives a saved-status thickness cue.
- Removed `aria-pressed` from the status action controls because the controls are submit actions, not the row's status indicator.
- Updated `docs/UI_SPEC.md`, `docs/USER_FLOWS.md`, and `DESIGN.md` to document consistent thin underlines and avoid current-choice styling for Not Completed rows.
- No schema, resolver, service, API route, provider, or product-scope changes were made.

Verification:
- Pass: `npm run agents:check`
- Pass: `npm run resolvers:check`
- Pass: `npm run lint`
- Pass: `npm run typecheck`
- Pass: `npm run test` (19 files, 110 tests).
- Pass: `npm run design-system:check`
- Pass: `python3 /Users/emi/.codex/skills/design-system-bench/scripts/classify_repo.py --root .`
- Pass: `python3 /Users/emi/.codex/skills/design-system-bench/scripts/detect_theme_support.py --root .`
- Pass: `python3 /Users/emi/.codex/skills/design-system-bench/scripts/scan_inventory.py --root . --out /tmp/cadence-design-system.manifest.json`
- Pass: `python3 /Users/emi/.codex/skills/design-system-bench/scripts/scan_usages.py --root . --manifest design-system.manifest.json --out /tmp/cadence-design-system.usage.json`
- Pass: `python3 /Users/emi/.codex/skills/design-system-bench/scripts/verify_traceability.py --root . --manifest design-system.manifest.json --usage design-system.usage.json --bench app/design-system/page.tsx`
- Pass: `npm run build`
- Browser QA: authenticated in-app browser `/timeline` desktop render showed sampled Completed and Not Completed status actions with transparent backgrounds, 0px borders, `textDecorationLine: underline`, `textDecorationThickness: 1px`, and no `aria-pressed`; no warning/error logs.
- Browser QA: authenticated in-app browser `/timeline` at 390px width showed the same sampled status action styles, no horizontal overflow, and no warning/error logs.

Remaining risk:
- Browser QA was visual/read-only. Status actions were not clicked to avoid mutating the user's live occurrence history.

### Timeline browser comment polish

Status: complete.

Implementation summary:
- Removed the visible Timeline page title so the Timeline feed starts directly with the current-day section while preserving an `sr-only` page heading for accessibility.
- Reworked Timeline occurrence rows so scheduled labels use a fixed column and behavior title first letters align across exact times and preset ranges.
- Added compact Timeline-only preset labels, so range occurrences display `Morning`, `Afternoon`, `Evening`, or `Night` without the full clock range; export, analytics, and reminder labels can still use the full range text.
- Added soft blue hover hues for unresolved and Needs decision rows, with a darker blue hover for Completed rows.
- Reworked expanded occurrence row layout so status actions stay pinned to the top-right and the expanded detail panel spans the full inner row width.
- Changed Timeline Completed status actions to use black text like Not Completed.
- Updated `docs/UI_SPEC.md`, `docs/USER_FLOWS.md`, `DESIGN.md`, the design-system Timeline fixture, and `design-system.usage.json` to match the implemented Timeline state.
- Added `tests/schedule.test.ts` coverage for full versus compact schedule labels.
- No schema, resolver, provider, status semantics, notification behavior, or product-scope changes were made.

Verification:
- Pass: `npm run test -- tests/schedule.test.ts`
- Pass: `npm run agents:check`
- Pass: `npm run resolvers:check`
- Pass: `npm run lint`
- Pass: `npm run typecheck`
- Pass: `npm run test` (19 files, 110 tests).
- Pass: `npm run design-system:check`
- Pass: `python3 /Users/emi/.codex/skills/design-system-bench/scripts/classify_repo.py --root .`
- Pass: `python3 /Users/emi/.codex/skills/design-system-bench/scripts/detect_theme_support.py --root .`
- Pass: `python3 /Users/emi/.codex/skills/design-system-bench/scripts/scan_inventory.py --root . --out /tmp/cadence-design-system.manifest.json`
- Pass: `python3 /Users/emi/.codex/skills/design-system-bench/scripts/scan_usages.py --root . --manifest design-system.manifest.json --out /tmp/cadence-design-system.usage.json`
- Pass: `python3 /Users/emi/.codex/skills/design-system-bench/scripts/verify_traceability.py --root . --manifest design-system.manifest.json --usage design-system.usage.json --bench app/design-system/page.tsx`
- Pass: `npm run build`
- Browser QA: authenticated in-app browser `/timeline` at 942px width showed no visible Timeline page title, the current-day section at the top of the content, zero horizontal overflow, compact `Evening` range labels, aligned behavior-title x positions, black Completed/Not Completed actions, and emitted hover CSS for `#eef6ff`, `#e8f2ff`, and `#2f669f`.
- Browser QA: opening the second current-day row kept status actions top-aligned with the summary (`0px` top delta) and measured the expanded details panel at the full inner row width.
- Browser QA: authenticated in-app browser `/timeline` at 390px width showed no visible Timeline page title, zero horizontal overflow, compact `Evening` range labels, and aligned behavior-title x positions.
- Browser QA: no warning or error logs were observed in the in-app browser after the Timeline checks.

Remaining risk:
- Browser QA was visual/read-only. Status action clicks were not performed to avoid mutating the user's live occurrence history.
- The in-app browser did not report `:hover` state from synthetic pointer movement, so hover was verified by emitted CSS and row class output rather than a live hover screenshot.

### Timeline row vertical alignment polish

Status: complete.

Implementation summary:
- Centered collapsed Timeline row contents so scheduled time, behavior title, collapsed status text, and Completed / Not Completed action text share the row's vertical midpoint.
- Preserved the expanded-row layout by returning status controls to top alignment when a row's details are open on desktop.
- Added a targeted Timeline status-action hover/focus weight rule so Completed and Not Completed become heavier on hover/focus without changing the global no-bold typography tokens.
- Updated `docs/UI_SPEC.md` and `DESIGN.md` to document the centered collapsed-row treatment and the status-link hover exception.
- No resolver, service, schema, provider, status semantic, or product-scope changes were made.

Verification:
- Pass: `npm run agents:check`
- Pass: `npm run resolvers:check`
- Pass: `npm run lint`
- Pass: `npm run design-system:check`
- Pass: `npm run typecheck`
- Pass: `npm run test` (19 files, 110 tests).
- Pass: `npm run build`
- Pass: design-system-bench classify, theme detection, inventory scan to `/tmp/cadence-design-system.manifest.json`, usage scan to `/tmp/cadence-design-system.usage.json`, and traceability verification.
- Browser QA: authenticated in-app browser `/timeline` at 1042x863 showed the selected `Clean Invisalign` row with time, title, status wrapper, Completed, and Not Completed all at `0px` vertical center delta from the row midpoint, no horizontal overflow, and no browser warning/error logs.
- Browser QA: authenticated in-app browser `/timeline` at 390x844 showed the selected row fitting within the viewport with no horizontal overflow and no browser warning/error logs.
- Browser QA: emitted page CSS includes `.timeline-status-action:not(:disabled):hover, .timeline-status-action:focus-visible { font-weight: 600; }` and the expanded-row `:has(details[open])` alignment rule.

Remaining risk:
- Browser QA was visual/read-only. Status action clicks were not performed to avoid mutating the user's live occurrence history.

### Timeline status hover color refinement

Status: complete.

Implementation summary:
- Removed the hover color shift from Timeline Completed and Not Completed text-link status actions while preserving the targeted hover/focus heavier text treatment.
- Updated `docs/UI_SPEC.md` and `DESIGN.md` so the status-action contract says hover/focus may become heavier without changing color.
- No resolver, service, schema, provider, status semantic, or product-scope changes were made.

Verification:
- Pass: `npm run agents:check`
- Pass: `npm run resolvers:check`
- Pass: `npm run lint`
- Pass: `npm run design-system:check`
- Pass: `npm run typecheck`
- Pass: `npm run test` (19 files, 110 tests).
- Pass: `npm run build`
- Pass: design-system-bench classify, theme detection, inventory scan to `/tmp/cadence-design-system.manifest.json`, usage scan to `/tmp/cadence-design-system.usage.json`, and traceability verification.
- Browser QA: authenticated in-app browser `/timeline` at 1042x863 showed the selected `Clean Invisalign` row with two Timeline status actions, no `hover:text-primary` class, no hover color CSS for `.timeline-status-action`, and no horizontal overflow or browser warning/error logs.
- Browser QA: authenticated in-app browser `/timeline` at 390x844 showed the selected row with no `hover:text-primary` status-action class, no horizontal overflow, and no browser warning/error logs.

Remaining risk:
- Browser QA was visual/read-only. Status action clicks were not performed to avoid mutating the user's live occurrence history.

### Timeline sidebar and hover stability polish

Status: complete.

Implementation summary:
- Changed the desktop app-shell brand label from `Cadence Tracker` to `Cadence`, matching the mobile header.
- Tied the active primary navigation item directly to the shared `--primary` blue token used by completed Timeline rows and primary card states.
- Reduced the Timeline occurrence summary gap between the scheduled time column and behavior title from `0.75rem` to `0.25rem`.
- Replaced the Timeline status-action hover/focus `font-weight` change with non-reflowing text-shadow emphasis so hovering Not Completed does not move the neighboring Completed action.
- Updated `docs/UI_SPEC.md` and `DESIGN.md` to document non-reflowing status-action hover/focus emphasis.
- No resolver, service, schema, provider, status semantic, notification behavior, or product-scope changes were made.

Verification:
- Pass: `npm run agents:check`
- Pass: `npm run resolvers:check`
- Pass: `npm run lint`
- Pass: `npm run typecheck`
- Pass: `npm run test` (19 files, 110 tests).
- Pass: `npm run design-system:check`
- Pass: design-system-bench inventory scan to `/tmp/cadence-design-system.manifest.json`, usage scan to `/tmp/cadence-design-system.usage.json`, and traceability verification.
- Pass: `npm run build`
- Browser QA: authenticated in-app browser `/timeline` at 854x863 showed sidebar label `Cadence`, active Timeline nav background `rgb(53, 114, 179)` matching `--primary: #3572b3`, row column gap `4px`, no horizontal overflow, no warning/error logs, and emitted status-action hover/focus CSS using `text-shadow` without a font-weight change.
- Browser QA: authenticated in-app browser `/timeline` at 390x844 showed header label `Cadence`, row column gap `4px`, no horizontal overflow, and no warning/error logs.

Remaining risk:
- Browser QA was visual/read-only. Status actions were not clicked to avoid mutating the user's live occurrence history.

### Sidebar rail specification

Status: complete.

Implementation summary:
- Applied the requested desktop sidebar rail contract in `components/layout/AppShell.tsx`: expanded width is 16rem, collapsed width is 4rem, main content uses matching `lg:pl-64` or `lg:pl-16`, and width/padding transitions run over 200ms.
- Added `sidebar-open` localStorage persistence for the desktop rail, defaulting to open on desktop when no saved preference exists.
- Rebuilt the desktop header around a stable `grid-cols-[4rem_1fr]` layout, with a logo toggle, collapsed hover crossfade to `PanelLeftOpen`, and an expanded right-side `PanelLeftClose` button.
- Reworked primary nav and footer account rows around a fixed 64px icon/avatar column, 40px nav rows, 16px icons, opacity-collapsed labels, row hover when expanded, and icon-cell hover/active treatment when collapsed.
- Replaced mobile sidebar behavior with a separate sticky 64px mobile header plus 60vw drawer, z-70 backdrop, z-80 drawer, Escape close, backdrop close, focus trapping, body scroll lock, edge swipe open, and left swipe close.
- Passed the authenticated profile name/email into the shell footer account trigger from the protected app layout.
- Added Tailwind token aliases for `card`, `muted-foreground`, and `ring`, updated `docs/UI_SPEC.md`, `docs/USER_FLOWS.md`, `DESIGN.md`, and refreshed design-system navigation preview/usage metadata.

Verification:
- Pass: `npm run agents:check`
- Pass: `npm run resolvers:check`
- Pass: `npm run lint`
- Pass: `npm run typecheck`
- Pass: `npm run test` (19 files, 110 tests).
- Pass: `npm run design-system:check`
- Pass: design-system-bench inventory scan to `/tmp/cadence-design-system.manifest.json`, usage scan to `design-system.usage.json`, and traceability verification.
- Pass: `npm run build`
- Browser QA: unauthenticated in-app browser correctly redirected protected `/timeline` to `/login?next=%2Ftimeline`.
- Browser QA: local `/design-system` desktop shell preview at 1280px measured 256px expanded sidebar width, 256px main left padding, 64px icon cell, 16px icons, 40px nav rows, 64px header, label opacity `1`, and no horizontal overflow.
- Browser QA: local `/design-system` mobile shell preview at 390px measured hidden desktop aside, sticky 64px mobile header, 60vw drawer width, 64px drawer header, z-80 drawer, z-70 backdrop, 200ms transform transition, closed drawer translate `-100%`, no body scroll lock while closed, and no horizontal overflow.

Remaining risk:
- The in-app browser did not have an authenticated Supabase session, so real protected app-shell interaction was not visually QA'd on `/timeline`.
- The design-system shell preview rendered the layout correctly but did not dispatch pointer-driven state changes reliably inside the contained preview, so collapse/open clicks, focus trap cycling, and swipe gestures were verified by implementation and static measurements rather than live pointer interaction.

### Desktop sidebar header divider removal

Status: complete.

Implementation summary:
- Removed the bottom divider from the desktop sidebar header container in `components/layout/AppShell.tsx`, matching the browser comment on the collapsed Expand navigation/logo cell.
- Updated `docs/UI_SPEC.md`, `docs/USER_FLOWS.md`, and `DESIGN.md` so the navigation contract records the unruled desktop header treatment.
- No resolver, service, schema, route, or product-scope changes were made.

Verification:
- Pass: `npm run agents:check`
- Pass: `npm run resolvers:check`
- Pass: `npm run design-system:check`
- Pass: `npm run lint`
- Pass: `npm run typecheck`
- Pass: `npm run test` (19 files, 110 tests).
- Pass: `npm run build`
- Pass: design-system-bench classify, theme detection, inventory scan to `/tmp/cadence-design-system.manifest.json`, usage scan to `/tmp/cadence-design-system.usage.json`, and traceability verification.
- Browser QA: authenticated `/timeline` at 1132x863 measured the fixed desktop sidebar header bottom border at `0px`, desktop sidebar width at `256px`, main left padding at `256px`, no horizontal overflow, and no browser warning/error logs.
- Browser QA: `/timeline` at 390x844 after reload measured desktop sidebar hidden, mobile top header height `64px`, mobile top and drawer header bottom borders still `1px`, main left padding `0px`, no horizontal overflow, and no browser warning/error logs.

Remaining risk:
- The annotated browser surface blocked pointer delivery for a live collapse click, but the removed border is on the shared desktop header container used in both expanded and collapsed rail states.

### Mobile drawer header divider removal

Status: complete.

Implementation summary:
- Removed the bottom divider from the mobile drawer Cadence header in `components/layout/AppShell.tsx`, matching the browser comment on `aside#mobile-navigation`.
- Updated `docs/UI_SPEC.md`, `docs/USER_FLOWS.md`, and `DESIGN.md` so the navigation contract records the unruled mobile drawer header treatment.
- No resolver, service, schema, route, or product-scope changes were made.

Verification:
- Pass: `npm run agents:check`
- Pass: `npm run resolvers:check`
- Pass: `npm run design-system:check`
- Pass: `npm run lint`
- Pass: `npm run typecheck`
- Pass: `npm run test` (19 files, 110 tests).
- Pass: `npm run build`
- Pass: design-system-bench classify, theme detection, inventory scan to `/tmp/cadence-design-system.manifest.json`, usage scan to `/tmp/cadence-design-system.usage.json`, and traceability verification.
- Browser QA: authenticated `/timeline` at 890x863 with the mobile drawer open measured the drawer Cadence header bottom border at `0px`, drawer width at `534px`, no horizontal overflow, and no browser warning/error logs.
- Browser QA: authenticated `/timeline` at 1132x863 measured the fixed desktop sidebar header bottom border still at `0px`, desktop sidebar width at `256px`, no horizontal overflow, and no browser warning/error logs.

Remaining risk:
- The sticky mobile top header still has its bottom divider; the browser comment targeted the open drawer header under Cadence.

### BehaviorLog status vocabulary alignment

Status: complete.

Implementation summary:
- Renamed the legacy stored occurrence status vocabulary to `completed` / `not_completed` across code, docs, tests, UI action values, analytics/export resolvers, and design-system fixtures.
- Added Supabase migration `20260612073554_rename_occurrence_statuses_to_behaviorlog.sql` to migrate existing `occurrences.status` rows and replace the check constraint.
- Kept UI labels as Completed / Not Completed and preserved existing semantics: unresolved is not failure, Needs decision remains derived, Completed sets `completed_at`, Not Completed clears it, and resolving cancels pending reminders.
- Export JSONL, CSV, and full JSON now emit `completed` / `not_completed`.

Verification:
- Pass: `npm run supabase -- db reset`
- Pass: `./node_modules/.bin/supabase gen types typescript --local > lib/db/database.types.ts`
- Pass: `npm run test -- tests/status.resolver.test.ts tests/timeline.resolver.test.ts tests/analytics.resolver.test.ts tests/export.resolver.test.ts tests/occurrence.resolver.test.ts tests/reminder.resolver.test.ts tests/completion-feedback.test.ts`
- Pass: `npm run agents:check`
- Pass: `npm run resolvers:check`
- Pass: `npm run lint`
- Pass: `npm run test` (19 files, 110 tests).
- Pass: `npm run typecheck`
- Pass: `npm run build`
- Pass: `npm run design-system:check`
- Pass: design-system-bench classify, theme detection, inventory scan to `/tmp/cadence-design-system.manifest.json`, usage scan to `/tmp/cadence-design-system.usage.json`, and traceability verification.
- Pass: `npm run supabase -- migration list` showed hosted migration history aligned except for pending `20260612073554`.
- Pass: `npm run supabase -- db push --dry-run` would apply only `20260612073554_rename_occurrence_statuses_to_behaviorlog.sql`.
- Pass: `npm run supabase -- db push --yes` applied `20260612073554_rename_occurrence_statuses_to_behaviorlog.sql` to hosted Supabase.
- Pass: `npm run supabase -- migration list` confirmed local and hosted migration histories now match through `20260612073554`.
- Pass: hosted `db query --linked` confirmed `occurrences_status_check` allows only `unresolved`, `completed`, and `not_completed`.
- Pass: hosted `db query --linked` confirmed zero `occurrences` rows remain with legacy status values.

Remaining risk:
- Browser QA was not rerun because UI-visible labels and layout treatments did not change; hidden action values and status behavior were covered by resolver/UI-adjacent tests plus build and design-system checks.

### BehaviorLog interoperability milestone 1

Status: complete.

Implementation summary:
- Added internal `occurrence_status_events` history for explicit status marks and corrections, including same-user occurrence ownership, same-user `revises_event_id` ownership, RLS, and authenticated select/insert-only grants so normal app code treats the table as append-only.
- Updated status transition planning so the resolver produces status-event semantics and the occurrence service persists the event after a status change.
- Added BehaviorLog `.behaviorlog.zip` export generation with manifest hashes, schema, README, AGENTS guidance, behavior/schedule/occurrence/status-event JSONL files, optional notes JSONL, app-specific extension fields under `app.cadence`, and synthetic medium-confidence status events for resolved legacy rows that predate status-event history.
- Added `/api/export/behaviorlog` and the Export screen download option while keeping JSONL, CSV, full JSON, and AI summary exports intact.
- Updated product, data-model, route, resolver, UI, flow, decision, README, and AGENTS docs so current-status snapshots and append-only status history are distinct.

Verification:
- Pass: `npm run supabase -- db reset`
- Pass: `npm run supabase -- gen types typescript --local` regenerated `lib/db/database.types.ts` after removing only the npm wrapper banner.
- Pass: local `pg_policies` query confirmed only `SELECT` and `INSERT` RLS policies on `occurrence_status_events`.
- Pass: local `information_schema.role_table_grants` query confirmed authenticated grants only `SELECT` and `INSERT` on `occurrence_status_events`.
- Pass: `npm run test -- tests/status.resolver.test.ts tests/export.resolver.test.ts`
- Pass: `npm run agents:check`
- Pass: `npm run resolvers:check`
- Pass: `npm run lint`
- Pass: `npm run typecheck`
- Pass: `npm run test` (19 files, 115 tests).
- Pass: `npm run build`
- Pass: `npm run design-system:check`
- Pass: `npm run supabase -- db push --dry-run` would apply only `20260612075036_add_occurrence_status_events.sql`; hosted database was not changed.
- Pass: `npm run supabase -- db push --yes` applied `20260612075036_add_occurrence_status_events.sql` to hosted Supabase after user authorization.
- Pass: `npm run supabase -- migration list` confirmed local and hosted migration histories now match through `20260612075036`.
- Pass: hosted `pg_policies` query confirmed only `SELECT` and `INSERT` RLS policies on `occurrence_status_events`.
- Pass: hosted `information_schema.role_table_grants` query confirmed authenticated grants only `SELECT` and `INSERT` on `occurrence_status_events`.
- Pass: hosted count query confirmed `occurrence_status_events` exists with 26 backfilled rows.
- Local render smoke: existing dev server at `http://localhost:3000` rendered `/design-system` with the BehaviorLog bundle export control and returned 200; dev logs showed no warnings or errors beyond the React DevTools info message.

Remaining risk:
- Occurrence status update and status-event insert are orchestrated by the service as separate Supabase calls; the BehaviorLog exporter synthesizes a fallback event for resolved rows without a status-event row, but a future RPC could make the write path fully atomic.

### Ticket 014: BehaviorLog import validation dry-run

Status: complete.

Implementation summary:
- Added a pure BehaviorLog import resolver that validates parsed bundle files, required file presence, manifest SHA-256 hashes, supported schema version, JSONL row parsing, required record types, cross-record references, unsupported top-level fields, status semantics, source confidence, `revises_event_id`, and dry-run conflict/skipped-record planning.
- Added explicit import-preview types plus a service wrapper that reads `.behaviorlog.zip` bytes through the ZIP utility and passes structured file contents to the resolver.
- Extended the ZIP utility to read stored and deflated ZIP entries without adding a dependency.
- Added resolver tests using a small BehaviorLog bundle generated by the existing export resolver, including happy-path import preview, hash/JSONL parse failures, local conflict detection, current-status snapshot handling without synthesized history, and unsupported-field reporting.
- Updated `docs/EXPORT_FORMATS.md`, `docs/DATA_MODEL.md`, `docs/AGENT_RESOLVERS.md`, and `scripts/check-resolvers.mjs` so import validation is registered as a dry-run-only resolver path.
- No routes, UI, schema changes, database writes, merge/restore behavior, destructive operations, or deduplication writes were added.

Verification:
- Pass: `npm run test -- tests/behaviorlog-import.resolver.test.ts`
- Pass: `npm run resolvers:check`
- Pass: `npm run typecheck`
- Pass: `npm run lint`
- Pass: `npm run test` (20 files, 120 tests).
- Pass: `npm run agents:check`
- Pass: `npm run build`

Remaining risk:
- This ticket exposes a service/resolver dry-run pathway only. A user-facing import screen, authenticated API route, and any future merge/write behavior remain separate future work and should require product/data-model updates before implementation.

### Ticket 015: BehaviorLog core conformance harness

Status: complete.

Implementation summary:
- Added a pinned upstream `emixd12/BehaviorLog-Bundle` reference validator snapshot from commit `d3b3850ed6cd4fb243b091ae14baeb24fdd653e9` and recorded the snapshot source/date.
- Added `scripts/behaviorlog-conformance.mjs` and `tests/behaviorlog-conformance.test.ts`; the test generates a Cadence BehaviorLog bundle through the export resolver, writes it as a temporary `.behaviorlog/` directory, runs the upstream validator snapshot, and confirms the same files remain readable by the dry-run import resolver.
- Tightened BehaviorLog import validation so unknown top-level fields in core records are validation errors while still being reported in `unsupportedFields`.
- Updated `docs/EXPORT_FORMATS.md` and `docs/AGENT_RESOLVERS.md` with the conformance harness and stricter import-validation contract.
- No schema changes, UI routes, import writes, merge/restore behavior, optional profiles, or database mutations were added.

Verification:
- Pass: `npm run test -- tests/behaviorlog-conformance.test.ts tests/behaviorlog-import.resolver.test.ts`
- Pass: `npm run agents:check`
- Pass: `npm run resolvers:check`
- Pass: `npm run lint`
- Pass: `npm run typecheck`
- Pass: `npm run test` (21 files, 122 tests).
- Pass: `npm run build`

Remaining risk:
- The upstream BehaviorLog Bundle specification is still draft; future alignment should intentionally update `tests/fixtures/behaviorlog-reference/SNAPSHOT.md` and the vendored validator snapshot before changing conformance expectations.

### Ticket 016: BehaviorLog Level 2 CSV views

Status: complete.

Implementation summary:
- Ticket 016 implementation is complete. The export resolver now emits optional `csv/behaviors.csv`, `csv/schedules.csv`, `csv/occurrences.csv`, and `csv/status_events.csv` BehaviorLog bundle views generated from the same normalized records as authoritative JSONL.
- CSV files are listed in `manifest.json` as optional `text/csv` files with SHA-256 hashes and null schema references.
- Tests now compare each CSV view to its JSONL source by record count and stable ID, and cover CSV escaping plus single-column JSON-string extension encoding.

Verification:
- Pass: `npm run test -- tests/export.resolver.test.ts tests/behaviorlog-conformance.test.ts tests/behaviorlog-import.resolver.test.ts`
- Pass: `npm run resolvers:check`
- Pass: `npm run agents:check`
- Pass: `npm run lint`
- Pass: `npm run typecheck`
- Pass: `npm run test` (21 files, 124 tests).
- Pass: `npm run build`

Remaining risk:
- No known Ticket 016 blockers. Keep CSV as optional compatibility views and do not add import writes, merge/restore behavior, user-facing import UI, or optional BehaviorLog profiles unless a later ticket explicitly changes scope.

### Ticket 017: BehaviorLog Intervention Profile export

Status: complete.

Implementation summary:
- Ticket 017 implementation is complete. The export service now loads user-scoped reminder deliveries for exported occurrence ids and passes sanitized delivery facts into the export resolver.
- The BehaviorLog resolver now emits optional `data/interventions.jsonl` records when exported occurrences have reminder deliveries, advertises the optional `interventions` profile, adds an Intervention schema definition, and lists the file in `manifest.json` with SHA-256 hash and `required: false`.
- Intervention records reference exported behaviors and occurrences, preserve channel, scheduled send time, sent time, delivery status, and sanitized failure reason, and keep Cadence delivery metadata under `extensions.app.cadence`.
- No reminder processing behavior, provider sends, import writes, message-body export, user-facing import UI, schema migration, or notification-provider side effects were added.

Verification:
- Pass: `npm run test -- tests/export.resolver.test.ts tests/behaviorlog-conformance.test.ts tests/behaviorlog-import.resolver.test.ts` (24 focused tests).
- Pass: `npm run typecheck`
- Pass: `npm run lint`
- Pass: `npm run agents:check`
- Pass: `npm run resolvers:check`
- Pass: `npm run test` (21 files, 127 tests).
- Pass: `npm run build`

Remaining risk:
- Import validation still ignores optional Intervention Profile records beyond manifest hash validation; any future intervention import or merge behavior needs a separate ticket and product/data-model update.

### Ticket 018: BehaviorLog import persistence foundation

Status: complete.

Implementation summary:
- Added Supabase migration `20260612221022_add_behaviorlog_import_tracking.sql`
  with `behaviorlog_import_runs` and
  `behaviorlog_import_record_mappings`.
- Import runs store user-owned bundle/schema metadata, manifest SHA-256,
  deterministic bundle fingerprint, producer metadata, subject/privacy hints,
  import mode, dry-run summary snapshot, status, failure message, and
  start/completion timestamps.
- Record mappings store external BehaviorLog ids to local Cadence UUIDs by
  import run and record type, with support for behavior, schedule, occurrence,
  status event, note, and intervention mappings.
- Mapping inserts are idempotent on `import_run_id, record_type, external_id`.
- Added repository and service helpers for import-run creation, status updates,
  and mapping insertion/listing. These helpers write only import tracking rows,
  not imported product records.
- Updated generated database types, domain aliases, `docs/DATA_MODEL.md`, and
  `docs/EXPORT_FORMATS.md`.
- Later Tickets 019-023 depend on this import run and external-to-local mapping
  contract.

Verification:
- Pass: `npm run supabase -- db reset`.
- Pass: local schema probe confirmed RLS enabled on both new tables.
- Pass: local `pg_policies` probe confirmed authenticated owner policies for
  select, insert, update, and delete on both new tables. The first probe without
  `roles::text` hit a Supabase CLI scan limitation for `name[]`, then passed
  with the cast.
- Pass: local grant probe confirmed no `anon` grants and explicit
  authenticated/service-role CRUD grants on both new tables.
- Pass: `./node_modules/.bin/supabase gen types typescript --local > lib/db/database.types.ts`.
- Pass: `npm run test -- tests/behaviorlog-import-write.service.test.ts`.
- Pass: `npm run test -- tests/behaviorlog-import.resolver.test.ts tests/behaviorlog-import-write.service.test.ts`.
- Pass: `npm run agents:check`.
- Pass: `npm run resolvers:check`.
- Pass: `npm run typecheck` after regenerating types with the direct Supabase
  binary; the npm script wrapper prints a banner that must not be redirected
  into `lib/db/database.types.ts`.

Remaining risk:
- Hosted Supabase now has migration
  `20260612221022_add_behaviorlog_import_tracking.sql`; `npm run supabase --
  db push --linked --yes` and `npm run supabase -- migration list --linked`
  passed on 2026-06-14.
- The tracking layer intentionally does not create, merge, overwrite, restore,
  delete, or deduplicate imported product records. Ticket 019 starts the first
  constrained product-record write path.

### Ticket 019: BehaviorLog create-only core import

Status: complete.

Implementation summary:
- Added `applyCreateMissingBehaviorLogImportPlan` in
  `lib/services/behaviorlog-import-write.service.ts`.
- The create-only apply path requires an existing valid dry-run import run with
  `import_mode = 'create_missing_only'` and an accepted valid dry-run summary.
- Creates clearly new behaviors, compatible schedule slots, and occurrences
  from authoritative BehaviorLog JSONL plan records.
- Inserts imported occurrences as `unresolved` first, appends imported
  `occurrence_status_events`, then updates occurrence `status`, `completed_at`,
  and `status_marked_at` from the latest imported status event for each
  occurrence.
- Does not synthesize status history from
  `occurrences.jsonl.current_status`; resolved snapshots without supporting
  status events remain warnings and imported occurrences stay unresolved.
- Uses `behaviorlog_import_record_mappings` for external-to-local behavior,
  schedule, occurrence, and status-event id mappings and for same-run
  idempotence.
- Added narrow repository helpers for import run lookup, schedule-slot
  create/lookup, occurrence create/lookup, and imported status-event duplicate
  fingerprint lookup.
- Extended the import resolver/types to preserve Cadence extension fields and
  warn/skip unsupported recurrence profiles, unsupported recurrence payloads,
  and unsupported schedule windows.
- Updated `docs/DATA_MODEL.md`, `docs/EXPORT_FORMATS.md`, and
  `docs/AGENT_RESOLVERS.md` for create-only import semantics.
- No notes, interventions, CSV-only data, merge behavior, overwrite/restore,
  destructive delete, user-facing import UI, or provider side effects were
  added.

Verification:
- Pass: `npm run test -- tests/behaviorlog-import-write.service.test.ts tests/behaviorlog-import.resolver.test.ts` (12 focused tests).
- Pass: `npm run typecheck`.
- Pass: `npm run lint`.
- Pass: `npm run agents:check`.
- Pass: `npm run resolvers:check`.

Remaining risk:
- Hosted Supabase now has the Ticket 018 import-tracking migration; `npm run
  supabase -- migration list --linked` shows local and remote
  `20260612221022` match.
- Ticket 020 should treat the create-only path as provenance-aware but not
  conflict-resolving. Merge preview must make mapping/map-to-existing decisions
  explicit instead of relying on the create-only writer.
- Ticket 022 remains responsible for occurrence-note import decisions; Ticket
  019 intentionally does not import notes.
- Ticket 023 remains preview-only for interventions; Ticket 019 intentionally
  does not write `reminder_deliveries`.

### Ticket 020: BehaviorLog conflict-aware merge preview

Status: complete.

Implementation summary:
- Added `resolveBehaviorLogImportMergePreview` with deterministic
  `create_new`, `map_to_existing`, `skip_existing`, and
  `conflict_requires_decision` actions.
- Added stable merge conflict codes and human-readable reasons for behavior,
  schedule, occurrence, status-event, note, and intervention preview records.
- Added merge-preview privacy/redaction summary and explicit BehaviorLog
  semantics flags for JSONL authority, CSV ignored for merge, status-events
  authority, unresolved-not-failure, and append-only status history.
- Extended existing-record inputs with schedules, import mappings,
  source-original ids, archive state, schedule shape, status-event semantics,
  and revision target fields used by merge preview.
- Added optional notes and interventions to merge preview only. No note writes,
  intervention writes, reminder delivery writes, provider calls, or reminder
  scheduling side effects were added.
- Added service helpers for merge preview from files/ZIP and an import-run
  persistence helper that stores the merge preview snapshot in
  `behaviorlog_import_runs.dry_run_summary` only.
- Preserved the Ticket 019 create-only `plan.action` contract and writer path.
- Updated `docs/DATA_MODEL.md`, `docs/EXPORT_FORMATS.md`, and
  `docs/AGENT_RESOLVERS.md`.

Verification:
- Pass: `npm run test -- tests/behaviorlog-import-merge-preview.test.ts tests/behaviorlog-import.resolver.test.ts tests/behaviorlog-import-write.service.test.ts` (17 focused tests).
- Pass: `npm run typecheck`.
- Pass: `npm run lint`.
- Pass: `npm run agents:check`.
- Pass: `npm run resolvers:check`.
- Pass: `npm run build` after rerunning with approved network access; the first
  sandboxed build failed because Next.js could not fetch the configured Google
  Font.

Remaining risk:
- Hosted Supabase now has the Ticket 018 import-tracking migration; `npm run
  supabase -- migration list --linked` shows local and remote
  `20260612221022` match.
- Ticket 021 should consume `preview.mergePreview.actions` and
  `dry_run_summary.mergePreview`, refuse unresolved
  `conflict_requires_decision` actions, and still avoid blind overwrite or
  destructive restore behavior.
- Ticket 022 remains responsible for note import decisions; Ticket 020 only
  previews notes.
- Ticket 023 remains responsible for detailed intervention validation; Ticket
  020 only previews interventions and does not write `reminder_deliveries`.

### Ticket 021: BehaviorLog user-approved merge write

Status: complete.

Implementation summary:
- Added `applyApprovedBehaviorLogMergePlan` in
  `lib/services/behaviorlog-import-write.service.ts`.
- The merge writer requires an import run with
  `import_mode = 'merge_by_user_approved_plan'`, a valid accepted
  `dry_run_summary.mergePreview`, and a matching input merge preview.
- Refuses to apply unresolved `conflict_requires_decision` actions and marks the
  import run failed on apply errors.
- Applies `create_new` records using the Ticket 019 create-only safeguards.
- Applies `map_to_existing` for behaviors, schedules, and occurrences by writing
  provenance mappings only; it does not overwrite local behavior, schedule, or
  occurrence fields.
- Appends imported status events that are not already mapped or duplicated,
  preserves `revises_event_id` when the revised event is mapped, and records all
  applied mappings.
- Updates occurrence current-status snapshots only after imported status events
  are accepted, and only when the imported event is the latest by effective
  time, recorded time, then stable id.
- Protects existing local explicit high-confidence status snapshots from
  ambiguous or lower-confidence imported events.
- Added `getBehaviorScheduleSlotById` repository helper and merge-write tests.
- Notes remain non-product writes in this phase; mappings may be recorded but
  occurrence note fill/conflict logic is left for Ticket 022.
- Interventions remain preview/provenance-only; no `reminder_deliveries`,
  provider calls, or scheduling side effects were added.
- Updated `docs/DATA_MODEL.md`, `docs/EXPORT_FORMATS.md`, and
  `docs/AGENT_RESOLVERS.md`.

Verification:
- Pass: `npm run test -- tests/behaviorlog-import-write.service.test.ts tests/behaviorlog-import-merge-preview.test.ts tests/behaviorlog-import.resolver.test.ts` (22 focused tests).
- Pass: `npm run typecheck`.
- Pass: `npm run lint`.
- Pass: `npm run agents:check`.
- Pass: `npm run resolvers:check`.
- Pass: `npm run build`.

Remaining risk:
- Hosted Supabase now has the Ticket 018 import-tracking migration; `npm run
  supabase -- migration list --linked` shows local and remote
  `20260612221022` match.
- Merge apply remains a multi-call Supabase workflow. A partial failure marks
  the import run `failed`, but already-written rows are not rolled back. This
  matches the Ticket 019 service pattern and should be revisited if the import
  UI later needs stronger atomicity.
- Ticket 022 should implement occurrence-note import/fill/conflict behavior on
  top of the existing note preview/provenance scaffolding.
- Ticket 023 should keep interventions preview-only unless a later data model
  adds passive imported intervention history.

### Ticket 022: BehaviorLog optional notes import

Status: complete.

Implementation summary:
- Added limited BehaviorLog note import support for occurrence-attached notes
  only.
- Parsed `data/notes.jsonl` sensitivity labels and source metadata into the
  import plan and merge-preview metadata.
- Added preview warnings for high and restricted sensitivity notes.
- Skipped behavior-attached, status-event-attached, review-attached, and
  AI-generated notes from product data with explicit warnings/reasons.
- Added safe merge-preview note decisions for created occurrence fill, empty
  mapped occurrence fill, already-matching mapped notes, missing targets, and
  differing existing-note conflicts.
- Added approved merge-apply support that fills `occurrences.note` only when
  the target occurrence is safely identified and the local note is still empty.
  Note mappings use the target occurrence id as `local_id`.
- Existing non-empty differing occurrence notes remain protected behind
  `occurrence_note_conflict`; note replacement was not added.
- Notes do not update occurrence status fields, status-event history, reminder
  deliveries, analytics inputs, adherence logic, provider calls, or scheduling.
- No generalized notes table was added.
- Updated `docs/DATA_MODEL.md`, `docs/EXPORT_FORMATS.md`,
  `docs/USER_FLOWS.md`, and `docs/AGENT_RESOLVERS.md`.

Verification:
- Pass: `npm run test -- tests/behaviorlog-import-notes.test.ts tests/behaviorlog-import-write.service.test.ts tests/behaviorlog-import-merge-preview.test.ts tests/behaviorlog-import.resolver.test.ts` (30 focused tests).
- Pass: `npm run typecheck`.
- Pass: `npm run lint`.
- Pass: `git diff --check`.

Remaining risk:
- Hosted Supabase now has the Ticket 018 import-tracking migration; `npm run
  supabase -- migration list --linked` shows local and remote
  `20260612221022` match.
- Ticket 023 should keep Intervention Profile import preview-only. It must not
  write `reminder_deliveries`, call providers, send notifications, schedule
  reminders, or reuse occurrence-note fill behavior for interventions.

### Ticket 023: BehaviorLog Intervention Profile import preview

Status: complete.

Implementation summary:
- Added optional `data/interventions.jsonl` parsing to BehaviorLog import
  preview.
- Intervention rows validate JSONL parsing, manifest hash, `record_type`,
  channel, delivery status, and behavior/occurrence references.
- Intervention preview plans are marked `action: "preview_only"` and
  `previewOnly: true`.
- Import summary now includes intervention count, preview-only count, and
  counts by channel, delivery status, and linked behavior.
- Merge preview includes intervention rows only as preview/provenance actions;
  it does not schedule, send, cancel, retry, or write operational reminders.
- Added warnings for sensitive delivery payload fields and values, including
  message bodies, endpoints, provider identifiers/secrets, subscription keys,
  recipient identifiers, emails, phones, and similar nested extension fields.
- Updated `docs/EXPORT_FORMATS.md`, `docs/NOTIFICATION_SPEC.md`, and
  `docs/AGENT_RESOLVERS.md`.
- No schema changes, `reminder_deliveries` writes, provider calls,
  notification-processing route calls, or `csv/interventions.csv` output were
  added.

Verification:
- Pass: `npm run test -- tests/behaviorlog-import-interventions.test.ts tests/behaviorlog-import-notes.test.ts tests/behaviorlog-import.resolver.test.ts tests/behaviorlog-import-merge-preview.test.ts tests/behaviorlog-import-write.service.test.ts` (36 focused tests).
- Pass: `npm run agents:check`.
- Pass: `npm run resolvers:check`.
- Pass: `npm run lint`.
- Pass: `npm run typecheck`.
- Pass: `npm run test` (25 files, 157 tests).
- Pass: `npm run build`.
- Pass: `env HOME=/private/tmp/cadence-supabase-home npm run supabase -- db reset`.
- Pass: `npm run supabase -- db push --linked --yes` applied
  `20260612221022_add_behaviorlog_import_tracking.sql` to hosted Supabase on
  2026-06-14.
- Pass: `npm run supabase -- migration list --linked` shows local and remote
  `20260612221022` match.
- Pass: `git diff --check`.

Remaining risk:
- Hosted Supabase now has the Ticket 018 import-tracking migration.
- Imported intervention records are intentionally not stored as passive history.
  A later ticket would need a separate data model before retaining imported
  intervention history outside the preview/import ledger.

### Ticket 024: User-facing BehaviorLog import UI

Status: complete.

Implementation summary:
- Added a first-class BehaviorLog import section to the authenticated Export
  screen. It accepts `.behaviorlog.zip` uploads, rejects unsupported files,
  persists preview import-run ledger rows, shows dry-run counts, errors,
  warnings, conflicts, privacy notes, note sensitivity warnings, intervention
  preview counts, and merge actions, and requires explicit confirmation before
  create-only or approved-merge writes.
- Added server actions and a UI-facing import service layer that regenerates
  previews from the submitted bundle payload during apply, gathers current local
  records for conflict-aware merge preview, and creates a mode-specific import
  run before calling the existing create-only or approved-merge writers.
- Added recent import-run history to the Export screen with mode, status,
  timestamps, and failure message display.
- Added repository reads for recent import runs, user import mappings, and all
  user occurrences. No schema changes were needed.
- Updated the design-system bench inventory/usage and added a live preview for
  the new import panel.
- Updated `docs/UI_SPEC.md`, `docs/USER_FLOWS.md`, `docs/ROUTE_MAP.md`, and
  `docs/EXPORT_FORMATS.md` for the user-facing import workflow.
- No destructive restore/overwrite behavior, generalized notes data model,
  intervention-to-reminder writes, provider calls, or raw bundle persistence
  were added.

Verification:
- Pass: `npm run test -- tests/behaviorlog-import-ui.test.tsx`.
- Pass: `npm run test -- tests/behaviorlog-import-ui.test.tsx tests/behaviorlog-import.resolver.test.ts tests/behaviorlog-import-merge-preview.test.ts tests/behaviorlog-import-write.service.test.ts` (31 focused tests).
- Pass: `npm run agents:check`.
- Pass: `npm run resolvers:check`.
- Pass: `npm run lint`.
- Pass: `npm run typecheck`.
- Pass: `npm run test` (26 files, 163 tests).
- Pass: `npm run build`.
- Pass: `npm run design-system:check`.
- Pass: browser QA on existing local dev server at `http://localhost:3000/export`
  for desktop and 390px mobile viewport; Import, upload control, recent runs,
  and downloads rendered with no horizontal overflow.
- Pass: `git diff --check`.

Remaining risk:
- Apply uses the submitted bundle payload to regenerate preview server-side; raw
  bundle contents are intentionally not stored in Postgres. Very large bundles
  remain capped by the current upload screen limit and may need a separate
  storage-backed handoff if future import sizes grow.
- The import UI depends on the existing Ticket 019-023 writer semantics; partial
  apply failures still mark the import run failed but do not roll back already
  written rows.

### Ticket 026: General BehaviorLog notes data model and import

Status: complete.

Implementation summary:
- Added the user-owned `imported_notes` table for passive BehaviorLog notes
  attached to behaviors, occurrences, status events, and reviews, with
  owner-scoped RLS, source metadata, source original id, sensitivity, role,
  imported timestamps, attachment target, and import-run provenance.
- Extended BehaviorLog import preview and apply so non-AI notes can be stored as
  imported note records while occurrence-attached notes may also fill the
  existing occurrence Note field only when the target is safe and the local note
  is empty.
- Changed note mappings to point at `imported_notes.id` instead of an occurrence
  id, and included existing imported notes in merge-preview context for
  idempotent mapping.
- Updated the Export import panel to distinguish imported note records from
  inline occurrence-note fills and to require a dedicated high/restricted note
  sensitivity acknowledgement before apply. The server enforces the
  acknowledgement as well as the UI.
- Updated product, data-model, export/import, UI, user-flow, resolver registry,
  and design docs so notes remain passive user-review context and do not feed
  status, adherence, reminders, or analytics.

Verification:
- Pass: `npm run test -- tests/behaviorlog-import-notes.test.ts tests/behaviorlog-import-merge-preview.test.ts tests/behaviorlog-import-ui.test.tsx tests/behaviorlog-import-write.service.test.ts` (35 focused tests).
- Pass: `npm run supabase -- db reset`.
- Pass: `./node_modules/.bin/supabase gen types typescript --local > lib/db/database.types.ts`.
- Pass: `npm run supabase -- db push --linked --dry-run`.
- Pass: `npm run supabase -- db push --linked --yes` applied
  `20260618120000_add_imported_notes.sql` to hosted Supabase.
- Pass: `npm run supabase -- migration list --linked` confirmed
  `20260618120000` is present locally and remotely.
- Pass: hosted schema probe confirmed `public.imported_notes` has RLS enabled
  with four policies.
- Pass: `npm run agents:check`.
- Pass: `npm run resolvers:check`.
- Pass: `npm run design-system:check`.
- Pass: `npm run lint`.
- Pass: `npm run typecheck`.
- Pass: `npm run test` (26 files, 169 tests).
- Pass: `npm run build`.
- Browser QA: started Cadence on `http://localhost:3003` because port 3000 was
  serving a different local app; authenticated `/export` rendered at desktop
  and 390px mobile with the import section present, no horizontal overflow, and
  no browser warning/error logs. `/design-system#ds-module-behaviorlog-import`
  rendered the idle import panel without overflow or warning/error logs.
- Browser QA: uploaded
  `/tmp/cadence-ticket-26-upload-20260618064102.behaviorlog.zip` through the
  Export import form and received `BehaviorLog preview ready.` with dry-run
  counts, `Imported note records`, `Inline note fills`,
  `high_sensitivity_note_present`, the note sensitivity warning, and the
  high/restricted note acknowledgement visible. The post-upload preview had no
  horizontal overflow at 1280px or 390px and no browser warning/error events.

Remaining risk:
- Browser QA stopped at preview and did not click Apply, so no product records
  were accepted from the browser upload. The apply path remains covered by
  resolver, service, and render tests.

### Ticket 027: Imported intervention history storage

Status: complete.

Implementation summary:
- Added user-owned passive `imported_interventions` storage with owner-scoped
  RLS, import-run ownership, optional local behavior/occurrence links, external
  BehaviorLog ids, intervention type, channel, delivery status,
  scheduled/sent timestamps, sanitized failure reason, source metadata,
  redaction indicators, and metadata.
- Extended BehaviorLog intervention preview so each intervention shows passive
  storage fields, dropped sensitive delivery fields, redacted fields, and
  explicit no-reminder/no-provider side-effect flags.
- Extended create-only and approved-merge apply paths to store passive
  intervention history idempotently through `behaviorlog_import_record_mappings`
  with `record_type = 'intervention'`.
- Updated the Export import panel to show imported intervention counts,
  passive-history rows, dropped/redacted field counts, per-intervention storage
  details, and applied imported-intervention counts.
- Updated data model, notification, export/import, UI, user-flow, and resolver
  registry docs. No Ticket 028 promotion behavior, `reminder_deliveries` writes,
  provider calls, scheduling, sending, cancellation, retry, or claim behavior
  was added.

Verification:
- Pass: `npm run supabase -- db reset`.
- Pass: `./node_modules/.bin/supabase gen types typescript --local > lib/db/database.types.ts`.
- Pass: `npm run test -- tests/behaviorlog-import-intervention-history.test.ts tests/behaviorlog-import-interventions.test.ts tests/behaviorlog-import-merge-preview.test.ts tests/behaviorlog-import-write.service.test.ts` (31 focused tests).
- Pass: `npm run test -- tests/behaviorlog-import-intervention-history.test.ts tests/behaviorlog-import-interventions.test.ts tests/behaviorlog-import-merge-preview.test.ts tests/behaviorlog-import-write.service.test.ts tests/behaviorlog-import-ui.test.tsx tests/behaviorlog-import.resolver.test.ts tests/behaviorlog-import-notes.test.ts` (51 focused tests).
- Pass: `npm run typecheck`.
- Pass: `npm run lint`.
- Pass: `npm run agents:check`.
- Pass: `npm run resolvers:check`.
- Pass: `npm run design-system:check`.
- Pass: `npm run test` (27 files, 173 tests).
- Pass: `npm run build`.
- Pass: local schema probe confirmed RLS enabled on
  `public.imported_interventions` with select/insert/update/delete owner
  policies. The first probe hit the Supabase CLI array scan limitation and
  passed after casting the policy list to text.
- Pass: `git diff --check`.
- Pass: `npm run supabase -- db push --linked --yes` applied
  `20260618220226_add_imported_intervention_history.sql` to hosted Supabase on
  2026-06-18.
- Pass: `npm run supabase -- migration list --linked` confirmed
  `20260618220226` is present locally and remotely.

Remaining risk:
- No known Ticket 027 blockers.

### Ticket 028: Promote imported interventions into reminder deliveries

Status: complete.

Implementation summary:
- Added nullable `reminder_deliveries.import_run_id` and
  `reminder_deliveries.imported_intervention_id` provenance columns with a
  pair check, same-user foreign keys, and a unique imported-intervention index.
- Added `lib/resolvers/imported-intervention-promotion.resolver.ts` to
  classify selected passive intervention rows and return operational reminder
  delivery plans only when the user selected rows, confirmed promotion, the row
  is a future pending reminder, the linked behavior/occurrence are current and
  owned by the user, the occurrence is unresolved, the behavior is active, the
  channel is enabled, and the scheduled send time matches current
  `resolveReminderDeliveries` output.
- Added `lib/services/imported-intervention-promotion.service.ts` to orchestrate
  user-scoped reads, existing-delivery checks, idempotent reminder-delivery
  insertion, and provenance attachment. Promotion does not call Sequenzy, Web
  Push, browser APIs, provider SDKs, or notification processing routes.
- Extended `importedInterventions.repo` and `reminderDeliveries.repo` with
  selected-row reads and pending-delivery provenance attachment.
- Added focused Ticket 028 coverage in
  `tests/imported-intervention-promotion.test.ts` for eligibility filtering,
  explicit selection/confirmation, duplicate selected records, existing
  delivery handling, provenance, historical/resolved-occurrence rejection, UTC
  timestamp normalization, and the migration contract.
- Updated data-model, notification, export/import, user-flow, and resolver
  registry docs so BehaviorLog import apply remains passive while promotion is
  a separate opt-in service-level workflow. No Export-screen promotion UI was
  added.

Verification:
- Pass: `npm run supabase -- migration new add_imported_intervention_promotion_provenance`.
- Pass: `npm run supabase -- db reset`.
- Pass: `./node_modules/.bin/supabase gen types typescript --local > lib/db/database.types.ts`.
- Pass: `npm run test -- tests/imported-intervention-promotion.test.ts` (22 focused tests).
- Pass: targeted ESLint for the new resolver, service, repository helpers,
  test, and resolver-check script.
- Pass: `npm run typecheck`.
- Pass: `npm run agents:check`.
- Pass: `npm run resolvers:check`.
- Pass: `npm run lint`.
- Pass: `npm run test` (28 files, 195 tests).
- Pass: `npm run build`.
- Pass: local Supabase schema probes confirmed nullable
  `reminder_deliveries.import_run_id` and `imported_intervention_id` columns
  plus the promotion pair check and same-user foreign-key constraints.
- Pass: `git diff --check`.
- Pass: `npm run supabase -- db push --linked --yes` applied
  `20260618222427_add_imported_intervention_promotion_provenance.sql` to hosted
  Supabase on 2026-06-18.
- Pass: `npm run supabase -- migration list --linked` confirmed
  `20260618222427` is present locally and remotely.

Remaining risk:
- The promotion workflow is implemented as a service-level contract. A
  user-facing review/confirmation UI or API route still needs a separate scoped
  ticket before users can invoke it from the app.

### Ticket 029: Public web hardening account safety baseline

Status: complete.

Implementation summary:
- Verified production reminder cron execution through Vercel runtime logs
  without manually triggering a send. Hourly production
  `GET /api/reminders/process` requests returned 200 from
  2026-06-18T01:00:03Z through 2026-06-19T00:00:03Z, with no production
  warning, error, or fatal logs in the previous seven days.
- Added public `/terms`, `/privacy`, and `/trust` routes with sparse account,
  privacy, portability, manual-status, and reminder-boundary copy.
- Linked Terms, Privacy, and Trust from Login and Settings.
- Added Settings account deletion with export acknowledgement and typed
  confirmation. The server action signs out globally, then deletes the current
  Supabase auth user through the server-only service-role client so existing
  `on delete cascade` ownership constraints remove hosted Cadence records.
- Added in-memory auth-failure rate limiting for `/api/push/subscribe` and
  `/api/reminders/process`.
- Bounded `/api/reminders/process?limit=` to a maximum batch size of 100.
- Added malformed UUID validation for occurrence status/note mutations before
  repository lookup.
- Added a static RLS policy registry test covering every user-owned public
  table in the migration set.
- Updated product, data-model, notification, route, UI, user-flow, operations,
  Vercel workflow, ticket, and design docs.
- No schema migration, Ticket 025A/025B restore work, marketing site,
  workspace restructuring, billing, AI, desktop/mobile, PWA/offline, provider
  sends, or admin/support surface was added.

Verification:
- Pass: `npm run test -- tests/account-deletion.service.test.ts tests/push-subscribe-route.test.ts tests/reminder-process-route.test.ts tests/legal-content.test.tsx tests/rls-policy-registry.test.ts` (19 focused tests).
- Pass: `npm run agents:check`.
- Pass: `npm run resolvers:check`.
- Pass: `npm run lint`.
- Pass: `npm run typecheck`.
- Pass: `npm run test` (31 files, 206 tests).
- Pass: `npm run build`.
- Pass: `npm run design-system:check`.
- Pass: `git diff --check`.
- Vercel tool verification: production project `cadence`
  (`prj_9tZKRXZ6IdT56ZLKVSmoJH5AAYhs`) latest deployment
  `dpl_APxAZ7fDhZjuNHvKFPMgZjMTP3eK` is `READY` at commit
  `e1bf0bfa56b00264b88ce3cb4307fc6c62823a3b`; reminder cron logs returned 200
  hourly as noted above.
- Browser QA: attempted Playwright against local dev server. The bundled
  Playwright browser was not installed, system Chrome failed to launch headless
  in this environment, and the local Next dev server had a stale lock reporting
  PID 49560 while no HTTP connection was available on port 3000. UI route
  rendering is covered by `npm run build` and render-level tests, but live
  desktop/mobile browser inspection remains unverified in this pass.

Remaining risk:
- Browser push subscription verification from Ticket 029 was superseded by the
  Browser push delivery troubleshooting note below: production Chrome now shows
  permission granted and an active PushSubscription. Real provider delivery
  still needs deployed-code verification.
- The latest production deployment became ready after the observed 00:00Z cron
  tick; confirm the next post-deploy hourly cron tick if strict latest-artifact
  cron verification is needed.
- The rate limiter is per-runtime in-memory protection. It is a practical
  baseline, not distributed abuse prevention across all Vercel instances.
- First-run onboarding, privacy-safe monitoring, and many-user RLS smoke QA were
  completed in Ticket 030 below.

### Ticket 030: Public web hardening follow-up

Status: complete.

Implementation summary:
- Made the future public web hardening follow-up explicit as Ticket 030 in
  `docs/TICKETS.md`.
- Added a server-derived, client-aware first-run setup panel on Timeline. It
  appears only while required setup remains incomplete and the user has not
  dismissed it in the current browser.
- The setup panel links to existing controls:
  `/behaviors#create-behavior`, `/settings#notifications`,
  `/settings#timezone`, and `/export#behaviorlog-import`. Import remains
  optional and non-blocking.
- Added anchor targets to the existing Behavior create, Settings notification,
  Settings timezone, and BehaviorLog import sections.
- Added privacy-safe structured monitoring helpers and wired OAuth callback,
  push subscription, and reminder processing route outcomes into sanitized
  runtime logs. No external monitoring SDK or third-party reporting provider was
  added.
- Added `npm run smoke:rls` backed by `scripts/supabase-rls-smoke.mjs`. The
  smoke command creates two temporary auth users with service-role access for
  setup/cleanup, then signs in with ordinary publishable-key clients and checks
  profile/category/behavior isolation.
- Updated product, UI, user-flow, route, notification, data-model, operations,
  Supabase, Vercel, design, ticket, and status docs.
- No schema migration, new product route, provider send, marketing site,
  admin/support dashboard, analytics/cookie SDK, workspace restructuring, or
  offline/PWA behavior was added.

Verification:
- Pass: `npm run test -- tests/onboarding.service.test.ts tests/monitoring.test.ts tests/rls-smoke-script.test.ts` (14 focused tests).
- Pass: targeted ESLint for changed onboarding, monitoring, route, and test
  files.
- Pass: `npm run smoke:rls`; configured Supabase target created two temporary
  users, verified six ownership checks, and cleaned up temporary users.
- Pass: `npm run agents:check`.
- Pass: `npm run resolvers:check`.
- Pass: `npm run lint`.
- Pass: `npm run typecheck`.
- Pass: `npm run test` (35 files, 241 tests).
- Pass: `npm run build`.
- Pass: `npm run design-system:check`.
- Pass: `git diff --check`.
- Browser QA: local dev server at `http://localhost:3000` with a temporary
  authenticated Chrome user rendered `/timeline` first-run setup at 1280px and
  390px. The setup links were present, there was no horizontal overflow, no
  console warnings/errors were captured, the mobile fixed Needs decision
  control sat over reserved blank panel space, and the temporary auth user was
  cleaned up.

Remaining risk:
- The monitoring implementation intentionally uses platform runtime logs only.
  If a later ticket adds a third-party monitoring provider, it needs an
  explicit privacy model and consent posture before sending events off-platform.
- `npm run smoke:rls` should be rerun before broad public launch and after
  material RLS/schema changes.

### Browser push delivery troubleshooting

Status: complete.

Implementation summary:
- Investigated the reported Chrome notification prompt issue from Settings.
  Chrome on production `https://cadence-blush-three.vercel.app/settings`
  already reports `Notification.permission = "granted"`, so clicking Save
  subscription will not show a browser authorization prompt for that origin
  unless the site permission is reset.
- Confirmed the production Chrome profile has one service worker registration
  for the app origin and an active PushSubscription through `fcm.googleapis.com`
  with both `p256dh` and `auth` keys present. The subscription step is therefore
  working in Chrome.
- Fixed the actual delivery gap: `/api/reminders/process` now calls combined
  reminder processing instead of the email-only processor.
- Added `web-push` server-side sending through `lib/services/web-push.service.ts`
  using `NEXT_PUBLIC_VAPID_PUBLIC_KEY` plus server-only `VAPID_PRIVATE_KEY`.
- Added browser-push due delivery listing/claiming, active subscription lookup,
  expired subscription deactivation, no-subscription failure logging, and
  missing-VAPID failure logging.
- Kept resolver logic pure; browser provider calls remain in services.
- Updated the Settings notification panel so the Permission row continues to
  show Chrome's real permission state (`Allowed`, `Blocked`, or `Not enabled`)
  after saving a subscription instead of replacing it with `Enabled`.
- Updated notification, route, Vercel workflow, and status docs.
- No schema migration, PWA caching, offline writes, marketing flow, or extra
  Settings surface was added.

Verification:
- Pass: `npm run test -- tests/reminder.service.test.ts tests/reminder-process-route.test.ts tests/push-subscribe-route.test.ts tests/push-browser.test.ts` (4 files, 26 tests).
- Pass: `npm run agents:check`.
- Pass: `npm run resolvers:check`.
- Pass: `npm run typecheck`.
- Pass: `npm run lint`.
- Pass: `npm run design-system:check`.
- Pass: `npm run test` (31 files, 212 tests).
- Pass: `npm run build`.
- Pass: `git diff --check`.
- Pass: local Astro dev server HTTP smoke for `/`, `/docs`, `/llms.txt`, and
  `/examples/cadence-demo.behaviorlog.zip` at `http://127.0.0.1:4321/`.
- NPM install for `web-push` / `@types/web-push` completed with the existing
  `ink` React peer warning and 0 vulnerabilities.
- Chrome QA: local `http://localhost:3000/login?next=%2Fsettings` reported
  secure context, Notification API available, `Notification.permission =
  "default"`, service worker support available, and PushManager available.
- Chrome QA: production Settings tab reported secure context, Notification API
  available, `Notification.permission = "granted"`, service worker support
  available, PushManager available, one app service worker registration, and an
  active FCM PushSubscription with required keys present. Endpoint and keys were
  not printed.

Remaining risk:
- A real browser-push provider send was not triggered during this troubleshooting
  pass. The new provider path is covered by mocked service tests; deployed
  production verification still needs this code deployed and a safe due browser
  reminder or approved test-send path.
- If the user wants to see Chrome's browser authorization prompt again on the
  production origin, the existing allowed notification permission must be reset
  in Chrome site settings first.

### Browser push production verification

Status: complete.

Implementation summary:
- Fixed reminder processor revalidation so expected reminder timestamps are
  compared as Temporal instants instead of raw strings. Supabase/Postgres can
  return the same UTC instant as `+00:00` while the resolver emits `Z`; those
  now match for both email and browser-push deliveries.
- Updated the Settings notification control so Save subscription remains the
  stable action label, retries `Notification.requestPermission()` from the
  user click whenever Chrome still allows prompting, and stays clickable in the
  blocked state so it can show factual unblock guidance.
- Updated notification, UI, and user-flow docs for click-driven permission
  retry and the browser limitation that already allowed or blocked origins do
  not show the native prompt again until site settings are reset.
- Deployed the isolated browser-push fix to the existing Vercel production
  project from a temporary clean copy so unrelated in-progress local changes
  were not included. Deployment `dpl_B5RBr2msxy29hnEHijAXjdf1iFdH` became
  READY and was aliased to `https://cadence-blush-three.vercel.app`.
- No schema migration, offline/PWA caching, marketing flow, or new Settings
  surface was added.

Verification:
- Pass: `npm run test -- tests/reminder.service.test.ts tests/push-browser.test.ts` (2 files, 18 tests).
- Pass: `npm run resolvers:check`.
- Pass: `npm run typecheck`.
- Pass: `npm run lint`.
- Pass: `npm run agents:check`.
- Pass: `npm run test` (32 files, 219 tests).
- Pass: `npm run build`.
- Production preflight: due email reminder count was 0 before calling the
  processor; active browser subscriptions existed for Apple Push and Chrome
  FCM.
- Production send QA: inserted one temporary Chrome-targeted browser-push
  behavior/occurrence/reminder due at `2020-01-01T15:00:00Z`, called
  `POST https://cadence-blush-three.vercel.app/api/reminders/process?limit=1`,
  and received `{ checked: 1, claimed: 1, sent: 1, failed: 0, cancelled: 0 }`.
  The delivery row was marked `sent` with `sent_at`, no error, and
  `processing_started_at`.
- Production cleanup QA: deleted the temporary behavior and confirmed 0
  matching QA behaviors and 0 matching QA reminder-delivery rows remained.
- Chrome QA: production Settings rendered `Allowed`, `Available`, and Save
  subscription; Chrome DevTools Protocol reported secure context, Notification
  API, service worker, PushManager, `Notification.permission = "granted"`, and
  an active FCM PushSubscription with both required keys present.

Remaining risk:
- Chrome will not show the native notification permission banner again for an
  origin that is already `granted` or `denied`. The production Chrome profile
  is currently `granted`, so seeing the banner again requires manually resetting
  the Cadence site permission to the ask/default state in Chrome site settings,
  then clicking Save subscription.
- Codex browser automation was not allowed to open `chrome://settings`, so the
  permission reset itself was not performed by the agent.

### Public product posture

Status: complete.

Implementation summary:
- Updated Cadence's source-of-truth posture from private-only personal app to
  public, open-source, single-account personal behavior tracker.
- Added `docs/PUBLIC_PRODUCT_ARCHITECTURE.md` to scope the target surface model:
  authenticated web app, Astro marketing site, future Tauri desktop app, future
  mobile app, and eventual shared packages.
- Documented the launch sequence: harden the current Google-auth web app for
  many independent accounts first; defer billing, AI speech features,
  desktop/mobile implementation, and workspace restructuring until explicit
  tickets.
- Added future tickets for public web hardening, Astro marketing, and workspace
  restructuring.
- Updated product, route, UI, flow, data, notification, export, operations,
  Vercel, desktop proposal, README, AGENTS, and decision docs to reflect the
  public posture and BehaviorLog Bundle demonstration/adoption role.

Verification:
- Pass: `npm run agents:check`
- Pass: `npm run resolvers:check`

Remaining risk:
- No implementation restructure was performed. Current routes, deployment
  assumptions, package layout, and app code remain unchanged until future
  tickets schedule the work.

### Settings timezone detection and override

Status: complete.

Implementation summary:
- Added a lightweight Settings timezone panel that shows the stored profile
  timezone, detects the browser/OS timezone with `Intl.DateTimeFormat()`, offers
  a Use detected timezone action, and supports manual IANA timezone entry.
- Added server-side timezone canonicalization/validation without geolocation or
  location permission.
- Saving a changed timezone updates `profiles.timezone`, updates all active
  behaviors to that timezone, and resyncs future unresolved occurrences through
  the existing occurrence generation service. Past occurrences, resolved
  occurrences, and archived behaviors remain historical records.
- Added repository helpers for profile timezone and active behavior timezone
  updates, plus service tests for validation, no-op saves, and active-behavior
  resync orchestration.
- Updated date/time, data-model, product, UI, user-flow, route, ticket, design,
  and status docs to reflect the implemented policy.
- No schema migration, location permission prompt, onboarding wizard, or
  out-of-scope app surface was added.

Verification:
- Pass: `npm run test -- tests/settings.service.test.ts`
- Pass: targeted ESLint for changed Settings/service/repository/test files.
- Pass: `npm run agents:check`
- Pass: `npm run resolvers:check`
- Pass: `npm run lint`
- Pass: `npm run typecheck`
- Pass: `npm run test` (32 files, 219 tests).
- Pass: `npm run build`
- Pass: `git diff --check`
- Browser QA: authenticated Chrome `/settings` rendered the new full-width
  Timezone panel with Current timezone, Browser timezone, IANA timezone field,
  Use detected timezone, and Save timezone controls. Browser timezone matched
  the saved timezone, so Use detected timezone was disabled as expected.
- Browser QA: a no-op Save timezone submit against the current timezone
  returned `POST /settings 200` and did not mutate behavior schedules.
- Browser QA: headless system Chrome verified unauthenticated `/settings`
  redirects to `/login?next=%2Fsettings` at 1280px and 390px with no horizontal
  overflow and no console warnings/errors.

Remaining risk:
- Browser QA intentionally did not change the real account timezone; the changed
  timezone mutation/resync path is covered by mocked service tests.
- Protected mobile Settings visual inspection could not be completed reliably
  with the available desktop-browser automation. The unauthenticated mobile
  redirect/login surface was verified at 390px.

### Behavior create submit feedback

Status: complete.

Implementation summary:
- Added a client-owned Behaviors create disclosure wrapper so successful create
  submissions close the create form instead of leaving it open.
- Kept the existing server action success text, `Behavior created.`, and moved
  create success feedback outside the collapsible form so the message remains
  visible after the form closes.
- Remounted the create form after success so a later create starts from blank
  default fields.
- Added the new create-section module to the design-system manifest, usage map,
  and dev-only bench preview.
- No schema, resolver, reminder, export, analytics, route, or product-scope
  changes were added.

Verification:
- Pass: targeted ESLint for changed Behaviors and design-system files.
- Pass: `npm run typecheck`
- Pass: `npm run design-system:check`
- Pass: `python3 /Users/emi/.codex/skills/design-system-bench/scripts/verify_traceability.py --root . --manifest design-system.manifest.json --usage design-system.usage.json --bench app/design-system/page.tsx`
- Pass: `git diff --check`
- Pass: `npm run agents:check`
- Pass: `npm run resolvers:check`
- Pass: `npm run lint`
- Pass: `npm run test` (32 files, 227 tests).
- Pass: `npm run build`
- Browser QA: headless system Chrome submitted the dev-only
  `BehaviorCreateSection` preview at `/design-system`; after the successful
  bench server action, the disclosure was closed, the success status remained
  visible, the title field was blank after remount, and desktop plus 390px
  mobile viewports had no horizontal overflow.

Remaining risk:
- The authenticated `/behaviors` production-data create path was not submitted
  during this pass; the wrapper behavior was verified through the same component
  in the dev-only bench with a harmless server action, and the real create
  action already returns `Behavior created.`.

### Ticket 031: Astro marketing site

Status: complete.

Implementation summary:
- Added `apps/marketing` as a sibling Astro app without moving or changing the
  authenticated Next.js app shell.
- Implemented `/`, `/standard`, `/cadence`, `/examples`, `/docs`, and `/about`.
  The homepage leads with BehaviorLog as the standard, while Cadence remains
  the main product object and demonstration tracker.
- Kept the current Cadence mark, added a quieter inline BehaviorLog companion
  mark, and reused the square ledger visual system with sanitized static
  Timeline and bundle captures.
- Added primary CTAs for Try Cadence, Read the Standard, Download Example
  Bundle, and View on GitHub.
- Added SEO and agent-readability outputs: canonical metadata, Open
  Graph/Twitter metadata, JSON-LD, Markdown alternate links, `sitemap.xml`,
  `robots.txt`, `llms.txt`, `llms-full.txt`, page `.md` mirrors, and
  `/data/route-manifest.json`.
- Added a build-time generator for a sanitized example
  `cadence-demo.behaviorlog.zip` bundle and a marketing agent-readability
  verification script.
- Added npm workspace scripts for `marketing:dev`, `marketing:build`,
  `marketing:check`, and `marketing:preview`; root Next scripts remain
  unchanged.
- Ran a post-launch impeccable polish pass on the marketing site: fixed the
  CSS font reset that caused browser-serif rendering, contained mobile table
  and code-panel overflow, made the sticky header solid, added semantic inline
  code styling, improved mobile tap-target text sizing, and adjusted the
  homepage hero/capture layout so it does not collide or clip.
- Recorded the max-visibility marketing crawl policy in
  `docs/CRAWL_POLICY.md`.
- Updated public product architecture, route map, product/UI/user-flow docs,
  future-update notes, operations, design docs, tickets, and this status ledger.

Verification:
- Pass: `npm run marketing:build`.
- Pass: `npm run marketing:check`.
- Pass: `unzip -t apps/marketing/public/examples/cadence-demo.behaviorlog.zip`.
- Pass: `node tests/fixtures/behaviorlog-reference/validate.mjs /private/tmp/cadence-demo-bundle-check-current`.
- Pass: `npm run agents:check`.
- Pass: `npm run resolvers:check`.
- Pass: `npm run design-system:check`.
- Pass: `npm run lint`.
- Pass: `npm run typecheck`.
- Pass: `npm run test` (39 files, 251 tests).
- Pass: `npm run build`.
- Pass: `git diff --check`.
- Pass: Chrome DevTools screenshot QA for `/` and `/docs` at a true 390px
  mobile viewport; both routes reported `docScrollWidth === docClientWidth`.
- Pass: Chrome DevTools screenshot QA for `/` at 1440px desktop; the hero
  product capture stayed inside the viewport and did not collide with the H1.
- Pass: local agent-readability audit against `http://127.0.0.1:4321` returned
  13 pass, 1 warn, 0 fail; the warning is uniform sitemap `lastmod` values,
  expected because all marketing routes launched on 2026-06-20.
- Pass: Vercel production deployment `dpl_3nZNis38DwHLQDndxyG37URrwRk4`
  reached `READY` for the separate `cadence-marketing` project and was aliased
  to `https://cadence-marketing-two.vercel.app`.
- Pass: live Vercel fetch checks returned 200 for `/`, `/docs`,
  `/sitemap.xml`, and `/llms.txt`; canonical and sitemap URLs point at
  `https://cadence-marketing-two.vercel.app`.

Remaining risk:
- A custom apex/domain is not configured yet. If the marketing site later owns
  apex `/`, keep the authenticated app entry behavior through an app subdomain
  or app-specific route.

### Codebase documentation refresh

Status: complete.

Implementation summary:
- Reviewed the implemented app, marketing workspace, migrations, resolver
  registry, tests, and source-of-truth docs for current-state drift.
- Updated bootstrap/governance/deployment docs so they describe the implemented
  authenticated Next.js app plus sibling Astro marketing site, not a future
  marketing site.
- Updated resolver registry text for the implemented BehaviorLog restore
  preview/apply UI and service test coverage.
- Updated ticket verification guidance to include the agent and resolver drift
  checks before the standard lint/typecheck/test/build sequence.
- No product code, schema, route, provider, or scope changes were made.

Verification:
- Pass: stale documentation scan for old marketing/future-surface wording.
- Pass: `npm run agents:check`.
- Pass: `npm run resolvers:check`.
- Pass: `npm run lint`.
- Pass: `npm run typecheck`.
- Pass: `npm run test` (39 files, 251 tests).
- Pass: `npm run build`.
- Pass: `git diff --check`.

### Occurrence decision correction implementation

Status: complete.

Implementation summary:
- Implemented Ticket 032 Needs Decision same-day correction retention.
- Timeline resolver input now carries `statusMarkedAt`, and the resolver derives
  same-day retained prior decisions from `status_marked_at` plus the user's
  local midnight boundary without adding a stored flag or status.
- Timeline service now fetches prior unresolved rows and prior resolved rows
  marked during the current local day, while the Needs Decision count continues
  to count only prior unresolved occurrences.
- Implemented Ticket 033 Analytics selected-day occurrence correction.
- Analytics selected-day data now lists all occurrences for the selected local
  date, including Completed, Not Completed, and Unresolved rows with status and
  note-state labels.
- Analytics selected-day review reuses the existing occurrence status and note
  services through `/analytics` server actions, preserving status-event
  semantics and refreshing the route after corrections.
- Updated route/resolver/design docs, the design-system fixture/usage map, and
  resolver tests. No schema, provider, navigation, dashboard/history route, bulk
  edit, offline mutation, stored missed status, or AI/coaching scope was added.

Verification:
- Pass: `npm run test -- tests/timeline.resolver.test.ts tests/analytics.resolver.test.ts`.
- Pass: `npm run agents:check`.
- Pass: `npm run resolvers:check`.
- Pass: `npm run design-system:check`.
- Pass: `npm run lint`.
- Pass: `npm run typecheck`.
- Pass: `npm run test` (39 files, 253 tests).
- Pass: `npm run build`.
- Browser QA: local Chrome against `http://localhost:3000` verified
  `/design-system#ds-module-analytics-screen` and
  `/design-system#ds-module-timeline` at 1280px and 390px with no horizontal
  overflow, no browser warnings/errors, visible `Review selected day`, selected
  day status/note controls, and the Needs decision button. Protected
  `/analytics` and `/timeline` redirected unauthenticated sessions to `/login`
  at both widths without horizontal overflow or browser warnings/errors.

Remaining risk:
- Browser QA used fixture-backed authenticated UI through `/design-system`
  because the automated Chrome context did not have a Supabase session.

### Analytics behavior-day correction refinement

Status: complete.

Implementation summary:
- Removed the Analytics page header description that showed `Local day
  boundary: <timezone>`.
- Converted the Overall adherence calendar into a passive summary. Overall day
  cells no longer open the correction panel.
- Added behavior-specific review selection through the `behavior` and `day`
  query parameters. The Analytics resolver now returns `selectedBehaviorDay`
  rows filtered by behavior id and local date, and marks the selected
  behavior calendar cell without making the UI filter review rows.
- Moved occurrence status/note correction into a compact Review day area inside
  the selected behavior row. It reuses the existing Analytics server actions
  and Timeline status/note controls.
- Updated the dev-only design-system Analytics fixture plus product, UI,
  user-flow, route, resolver-registry, design, and status docs.
- No schema, migration, provider, notification, export, route-navigation,
  dashboard/history route, bulk edit, stored missed status, or AI/coaching
  scope was added.

Verification:
- Pass: `npm run test -- tests/analytics.resolver.test.ts`.
- Pass: `npm run resolvers:check`.
- Pass: `npm run typecheck`.
- Pass: targeted ESLint for Analytics page/component/resolver/service/test and
  design-system fixture files.
- Pass: `npm run agents:check`.
- Pass: `npm run design-system:check`.
- Pass: `npm run lint`.
- Pass: `npm run test` (41 files, 257 tests).
- Pass: `npm run build`.
- Pass:
  `python3 /Users/emi/.codex/skills/design-system-bench/scripts/verify_traceability.py --root . --manifest design-system.manifest.json --usage design-system.usage.json --bench app/design-system/page.tsx`.
- Pass: `git diff --check`.
- Browser QA: Playwright with system Chrome against
  `http://localhost:3000/design-system?preview=module.analytics-screen#ds-module-analytics-screen`
  at 1280px and 390px showed the Analytics fixture with no horizontal
  overflow, no console warnings/errors, no `Local day boundary` copy, no old
  `Review selected day`/`Select a day to review` copy, passive overall
  calendar cells, behavior calendar review links, and the in-row Review day
  panel.
- Browser QA: unauthenticated `/analytics` redirected to
  `/login?next=%2Fanalytics` at 1280px and 390px with no horizontal overflow,
  no console warnings/errors, and no local-boundary copy.

Remaining risk:
- Authenticated live `/analytics` production-data QA was not performed because
  the browser context did not have a Supabase session; the same
  `AnalyticsScreen` was verified through the fixture-backed design-system
  route.
- The worktree already contained unrelated auth/proxy/package/design-system
  edits before this task; this refinement did not revert or normalize them.

### Analytics behavior-day scroll retention

Status: complete.

Implementation summary:
- Updated behavior calendar review links on Analytics to preserve scroll
  position while opening a selected behavior day. This prevents the page from
  jumping back to the top when the in-row Review day panel opens.
- No resolver, service, schema, route, provider, export, or product-scope
  changes were added.

Verification:
- Pass: targeted ESLint for `components/analytics/AnalyticsScreen.tsx`.
- Pass: `npm run typecheck`.
- Pass: `npm run build`.

Remaining risk:
- Authenticated live click QA was not performed because the browser context did
  not have a Supabase session.

### Analytics top-fold layout compaction

Status: complete.

Implementation summary:
- Reworked the top Overall adherence section so the active range selector sits
  beside the heading on desktop, while the adherence percentage and status
  counts stay grouped in the left summary column.
- Moved the overall calendar into the same fold as the summary on desktop,
  kept only the See Legend control above it, and removed the extra divider
  line between the heading/range row and summary body.
- Added compact date hover/focus labels to Analytics heatmap cells using the
  existing resolver-provided short date label.
- Removed the extra divider line above Behavior counts.
- Changed behavior category display from a bordered chip beside the behavior
  name to plain `Category: <name>` metadata below the behavior name.
- Enlarged behavior heatmaps so 30-day calendars fill more of the row height
  while preserving the seven-column square-cell aspect ratio.
- Kept the mobile order stacked and readable: heading, range selector,
  adherence metric, counts, then calendar.
- No resolver, service, schema, route, provider, export, navigation, or
  product-scope changes were added.

Verification:
- Pass: `npm run agents:check`.
- Pass: `npm run resolvers:check`.
- Pass: `npm run lint`.
- Pass: `npm run typecheck`.
- Pass: `npm run test` (41 files, 257 tests).
- Pass: `npm run design-system:check`.
- Pass: `npm run build`.
- Browser QA: authenticated in-app browser `/analytics` at 1024x768 verified no
  horizontal overflow, no Calendar heading, no top border/padding on the
  summary body or Behavior counts section, no behavior category chips,
  `Category: Medical` metadata, 304px by 216px behavior heatmaps in the 30-day
  view, short date `data-hover-label` values, and no warning/error logs.
- Browser QA: authenticated in-app browser `/analytics` at 390px verified no
  horizontal overflow, no Calendar heading, plain category metadata, the larger
  behavior calendar staying inside the viewport, and no warning/error logs.

Remaining risk:
- The in-app browser automation did not expose CSS `:hover` state from
  programmatic mouse movement, including CDP mouse events. The heatmap cells
  have the expected `data-hover-label` attributes and tooltip CSS, but the
  visual hover chip was not proven through automated hover-state capture.

### Analytics behavior-day review cohesion

Status: complete.

Implementation summary:
- Reworked the selected behavior-day Analytics review so it reads as one
  cohesive expansion inside the selected behavior row rather than a divided
  subtable.
- Removed internal divider lines from the review area and replaced the Review
  day heading with Behavior date.
- Replaced scheduled-time/status chips and note-state labels with plain text
  rows for Time of behavior, Status, and Note. Empty notes display as italic
  No note; saved notes display the note text.
- Hid per-occurrence status and note editing behind a Review disclosure by
  default. When opened, Change status sits beside the Completed / Not Completed
  actions when space allows, followed by the existing Note form.
- Removed the stale Analytics selected-day `noteStateLabel` resolver/type
  field and refreshed the design-system usage line numbers.
- Updated `DESIGN.md`, `docs/UI_SPEC.md`, and `docs/USER_FLOWS.md` for the new
  behavior-day review contract.
- No schema, route, provider, notification, export, navigation, dashboard,
  stored-status, or product-scope changes were added.

Verification:
- Pass: `npm run test -- tests/analytics.resolver.test.ts`.
- Pass: targeted ESLint for the Analytics component/resolver/types/test and
  design-system fixture files.
- Pass: `npm run typecheck`.
- Pass: design-system usage scan for current line numbers.
- Pass:
  `python3 /Users/emi/.codex/skills/design-system-bench/scripts/verify_traceability.py --root . --manifest design-system.manifest.json --usage design-system.usage.json --bench app/design-system/page.tsx`.
- Pass: `npm run design-system:check`.
- Pass: `npm run agents:check`.
- Pass: `npm run resolvers:check`.
- Pass: `npm run lint`.
- Pass: `npm run test` (41 files, 257 tests).
- Pass: `npm run build`.
- Browser QA: in-app browser against
  `http://127.0.0.1:3000/design-system?preview=module.analytics-screen#ds-module-analytics-screen`
  at 1280px verified Behavior date copy, no Review day copy, plain Time of
  behavior / Status / Note labels, no internal review borders, Review closed by
  default, no horizontal overflow, and no warning/error logs.
- Browser QA: the desktop Review disclosure opened with a 512px editor,
  Change status aligned with the Completed action, visible Note textarea, and
  no horizontal overflow.
- Browser QA: at 390px mobile, the closed and opened review states had no
  horizontal overflow, the Note textarea fit the available panel width, and the
  status controls wrapped as expected.

Remaining risk:
- Authenticated live `/analytics` production-data QA was not performed because
  the browser context did not have a Supabase session; the same
  `AnalyticsScreen` was verified through the fixture-backed design-system
  route.
- The design-system inventory scan still reports broader pre-existing manifest
  drift outside this touched Analytics surface. This refinement refreshed only
  the usage map line numbers affected by the edited component.

### Minimal action primitive and divider rollout

Status: complete.

Implementation summary:
- Replaced the product button primitive with transparent underlined text
  actions. Primary actions now use Ink Black, secondary actions use Readable
  Ash, and destructive actions use Rust Signal.
- Propagated the primitive through auth, Timeline status/note actions,
  behavior create/edit/archive/restore controls, settings actions, export and
  BehaviorLog import/restore controls, legal links, design-system previews, and
  marketing CTAs.
- Replaced non-functional full perimeter panel borders with divider-based
  sections across onboarding, login, settings, export, shared placeholder
  panels, and action feedback messages.
- Preserved real boundaries for form fields, segmented selected controls,
  heatmap cells, dense preview tables, dialogs, and the fixed Needs decision
  launcher.
- Updated `DESIGN.md` and `docs/UI_SPEC.md` so future UI work keeps primary
  actions black, secondary actions grey, and structural containers unboxed.
- No schema, route, provider, notification, export-format, stored-status, or
  product-scope changes were added.

Verification:
- Pass: `npm run agents:check`.
- Pass: `npm run resolvers:check`.
- Pass: `npm run lint`.
- Pass: `npm run typecheck`.
- Pass: `npm run test` (41 files, 257 tests).
- Pass: `npm run build`.
- Pass: `npm run design-system:check`.
- Pass:
  `python3 /Users/emi/.codex/skills/design-system-bench/scripts/verify_traceability.py --root . --manifest design-system.manifest.json --usage design-system.usage.json --bench app/design-system/page.tsx --config design-system.config.json`.
- Pass: `git diff --check`.
- Pass: `npm run marketing:check`.
- Pass: `npm run marketing:build`.
- Browser QA: restarted local dev server on `http://localhost:3000` and
  verified `/design-system` at 1280px and 390px. Primary primitive computed as
  transparent, 0px border, underlined Ink Black; secondary computed as
  transparent, 0px border, underlined Readable Ash; disabled stayed muted with
  no underline; overlay panel computed white with no perimeter border; no
  horizontal overflow on either viewport.

Remaining risk:
- Authenticated live app routes were not manually walked with a signed-in
  Supabase session. The changed authenticated components were covered through
  fixture-backed design-system previews, static scans, typecheck, tests, and
  build.

### Marketing hero and header cleanup

Status: complete.

Implementation summary:
- Reworked the Astro homepage hero into a cleaner two-column composition with
  the supplied single exported image that combines the trajectory horse,
  MacBook Pro frame, and sanitized Cadence Timeline capture.
- Removed the marketing header bottom divider and changed marketing navigation
  links to the underlined text-action convention. The Log in app-entry action
  now uses the same primitive with stronger weight instead of a filled button.
- Reduced marketing H2 scale by one step so secondary section headings no
  longer compete with the homepage H1.
- Added the supplied hero image under `apps/marketing/public/brand/`.
- Updated `DESIGN.md`, `docs/UI_SPEC.md`, and `design-system.surfaces.json`
  so the header treatment, H2 scale, and hero visual are documented and
  traceable.
- No schema, route, provider, resolver, stored-status, notification, export, or
  product-scope changes were added.

Verification:
- Pass: `npm run agents:check`.
- Pass: `npm run resolvers:check`.
- Pass: `npm run lint`.
- Pass: `npm run typecheck`.
- Pass: `npm run test` (41 files, 257 tests).
- Pass: `npm run build`.
- Pass: `npm run marketing:build`.
- Pass: `npm run marketing:check`.
- Pass: `npm run design-system:check`.
- Pass: `git diff --check`.
- Design-system maintenance scan: usage scan still reports 30 product usages
  and 0 bench previews. The generic inventory scan detects broader Astro
  surface files that remain intentionally cataloged through
  `design-system.surfaces.json` rather than the strict web-app manifest.
- Browser QA: local Astro dev server rendered the homepage at 1280x900 with no
- Browser QA: `http://localhost:4321/` rendered the homepage at 1280x900 with
  no header divider, underlined text-action navigation, the supplied hero image
  in place, `Log in` computed as transparent, borderless, underlined, and
  `font-weight: 600`, and the first H2 computed at 46.08px instead of the prior
  larger scale.
- Browser QA: 390x844 capture showed wrapped CTAs, no measured document-level
  horizontal overflow, `Log in` computed as transparent, borderless,
  underlined, and `font-weight: 600`, and the first H2 computed at 31.2px.

Remaining risk:
- The homepage hero is now a static exported image. Future copy or sample-data
  changes inside the image require regenerating the source image asset.

### Behaviors unresolved detail count removal

Status: complete.

Implementation summary:
- Removed the Unresolved row from per-behavior and category detail count grids
  on Behaviors while preserving the top Overall adherence Unresolved count,
  neutral unresolved heatmap cells, and behavior date review rows.
- Updated product, UI, user-flow, and design docs so behavior/category detail
  count grids are resolved-outcome summaries only.
- No resolver, schema, route, provider, export, navigation, or product-scope
  expansion was added.

Verification:
- Pass: `npm run agents:check`.
- Pass: `npm run resolvers:check`.
- Pass: `npm run design-system:check`.
- Pass: `npm run lint`.
- Pass: `npm run typecheck`.
- Pass: `npm run test` (55 files, 320 tests).
- Pass: `npm run build`.
- Browser QA: headless Chrome against
  `http://localhost:3000/design-system?preview=module.behavior-list#ds-module-behavior-list`
  at 1024px and 390px showed no horizontal overflow, the Overall adherence
  count grid still showing Unresolved, and behavior/category count grids
  showing only Completed and Not Completed.

Remaining risk:
- Authenticated in-app browser QA for live `/behaviors` could not be automated:
  the Browser MCP was unavailable in this thread and Computer Use is blocked
  from inspecting the Codex app. The same `BehaviorList` surface was verified
  through the fixture-backed design-system route.

### UX journey inventory and testing backbone

Status: complete.

Implementation summary:
- Added `docs/UX_JOURNEY_INVENTORY.md` with seven testing personas and 22
  current-scope journey families across marketing, login, first-run setup,
  behavior creation/maintenance, Timeline, Needs decision, review/correction,
  reminders, timezone, export/import/restore, legal/trust, account deletion,
  mobile navigation, and machine-readable public docs.
- Added `docs/UX_TESTING_PLAN.md` with persona assignment, environment and
  viewport matrix, safe-data rules, severity model, observation rubric, and 13
  task scripts for future expert or participant testing.
- Added `docs/UX_RESEARCH_LOG.md` as the durable research and bug/glitch log.
  The initial pass records UX-001 through UX-035, including sub-agent findings
  for acquisition/trust, first-run activation, daily Timeline,
  recovery/review, reminders/settings, and portability.
- The pass intentionally did not implement UI or behavior fixes. Findings that
  came from source review are marked Open or Needs reproduction so future work
  can verify them in browser before changing product behavior.
- Existing dirty files in auth/behavior UI components were not touched.

Verification:
- Pass: `npm run agents:check`.
- Pass: `npm run resolvers:check`.
- Pass: `npm run lint`.
- Pass: `npm run typecheck`.
- Pass: `npm run test` (55 files, 324 tests).
- Pass: `npm run build`.
- Pass: `npm run marketing:check`.
- Pass: `npm run design-system:check`.
- Pass: `git diff --check`.

Remaining risk:
- No live browser walkthrough was performed in this pass. Several source-review
  findings in `docs/UX_RESEARCH_LOG.md` are explicitly marked Needs
  reproduction before implementation.

### Behavior schedules hierarchy and form update

Status: complete.

Implementation summary:
- Added `behavior_schedules` as the recurrence-owning parent of schedule time
  entries, linked `behavior_schedule_slots` to schedules, backfilled existing
  behavior rows into one schedule, and preserved legacy behavior-level
  `recurrence_rule`/`scheduled_time` compatibility.
- Reworked Behavior create/edit parsing, service writes, repository reads, and
  cached behavior/export mapping so old records normalize to `schedules[]` and
  new saves persist multiple schedules with multiple exact-time or range
  entries.
- Updated occurrence generation to iterate schedules, expand each schedule's
  recurrence and time entries, preserve timezone/history behavior, and merge
  duplicate generated occurrences with the same behavior, local date, start
  time, and end-time/range identity before reminders or analytics see them.
- Rebuilt the Behavior form schedule section into the compact table-like
  hierarchy: Add time stays inside a schedule, Add schedule creates a new
  recurrence row, custom time ranges are supported, reminders are separated by
  a divider, decorative form icons were avoided, and Save behavior uses the
  product-action primary primitive.
- Updated JSON/JSONL/full JSON/BehaviorLog export paths to include app-native
  `schedules[]` while keeping backward-compatible schedule fields.
- Updated product, data model, recurrence, UI, user-flow, notification, export,
  date/time, decisions, and resolver-registry docs for the new hierarchy.

Verification:
- Pass: `npm run agents:check`.
- Pass: `npm run resolvers:check`.
- Pass: `npm run design-system:check`.
- Pass: `npm run lint`.
- Pass: `npm run typecheck`.
- Pass: `npm run test` (55 files, 331 tests).
- Pass: `npm run build`.
- Pass: `npm run supabase -- db reset`.
- Pass: Supabase local type generation with
  `npm run --silent supabase -- gen types typescript --local`, redirected to
  `lib/db/database.types.ts`, after removing the earlier npm banner pollution
  from the documented non-silent command.
- Pass: hosted migration deployment with `npm run supabase -- db push`;
  `npm run supabase -- migration list` confirmed local and remote histories
  match through `20260626140000`.
- Pass: hosted `npm run smoke:rls` after the schema/RLS change.
- Pass: `git diff --check`.

Remaining risk:
- Chrome-extension QA against local `/behaviors` created a temporary two-schedule
  behavior, verified the persisted summary
  `Schedule 1: Daily, 8:00 AM, 11:00 PM; Schedule 2: Every 2 days, 11:00 PM -
  11:30 PM`, opened the edit form, and archived the temporary behavior.
- Hosted application code was not deployed in this pass; only the hosted
  Supabase migration was pushed.

### Behavior form browser-comment polish

Status: complete.

Implementation summary:
- Applied the annotated `/behaviors` form polish: Details now titles the
  title/category/description group, Category uses a narrower responsive column
  than Title, Schedule no longer has a top divider or schedule-count label, and
  the overlap helper copy now includes the requested leading asterisk.
- Reworked the description field into an auto-growing single-underline
  textarea so the underline stays directly under the entered text as line
  breaks are added.
- Restored named time-range presets for schedule entries and removed native
  time inputs from the form, avoiding the clock icons while preserving exact
  `HH:MM` entry and custom ranges.
- Applied the second annotated form-density pass: create-form contents align
  under the Create behavior summary text, field controls use shorter underline
  heights, Details has more breathing room before Title, recurrence interval
  controls stay on one line, time entries no longer draw a perimeter box or
  duplicate the selected range label, the Time mode column was removed, nested
  Add time/Add schedule actions are lower-emphasis, and Reminders no longer has
  its own top divider.

Verification:
- Pass: `npm run agents:check`.
- Pass: `npm run resolvers:check`.
- Pass: `npm run design-system:check`.
- Pass: `npm run lint`.
- Pass: `npm run typecheck`.
- Pass: `npm run test -- tests/behavior-form.test.ts` (12 tests).
- Pass: `npm run test` (55 files, 334 tests).
- Pass: `npm run build`.
- Pass: Chrome-extension QA against local `/behaviors`: verified Details,
  Schedule, and Reminders legends; no native `input[type="time"]` controls in
  the open form; preset range options for Custom range, Morning, Afternoon,
  Evening, and Night; product-action primary Save behavior styling; helper copy
  with the leading asterisk; and auto-growing description behavior.
- Pass: Chrome-extension QA after the second pass against local `/behaviors`:
  verified compact 32px title/category controls, 32px Details-to-Title visual
  gap, create-form x-position aligned with the Create behavior summary text, no
  Time mode text, no preset range summary label, unboxed time-entry wrapper,
  smaller nested add-action classes, no horizontal overflow at 390px mobile,
  and desktop/mobile screenshots.

Remaining risk:
- The second browser-comment pass is verified locally but has not been pushed to
  hosted production yet.

### Behaviors review browser-comment polish

Status: complete.

Implementation summary:
- Applied the annotated `/behaviors` review polish: Overall adherence now uses
  a single label/percentage header row with a colon, the selected range sits
  directly underneath in muted text, and the percentage uses the section-scale
  20px type instead of the prior large metric treatment.
- Aligned the expanded Details and Settings content with the disclosure trigger
  label start, moved Archive behavior to the far side of the Save/Cancel footer
  line on desktop while keeping it as a separate form, and normalized the
  annotated action text to 12px.
- Aligned the overlapping-occurrences helper copy with the Add time control and
  raised Add schedule to the 12px text-action size.
- Updated `docs/UI_SPEC.md` and `DESIGN.md` so the Behaviors review source of
  truth matches the new adherence header/range and Archive footer placement.

Verification:
- Pass: `npm run agents:check`.
- Pass: `npm run resolvers:check`.
- Pass: `npm run lint`.
- Pass: `npm run typecheck`.
- Pass: `npm run test` (55 files, 341 tests).
- Pass: `npm run build`.
- Pass: `npm run design-system:check`.
- Browser QA: authenticated in-app browser against local `/behaviors` at
  1545x1425 verified 0px Details alignment delta, Overall adherence percentage
  at 20px, range 4px under the heading row, Add schedule/Save/Cancel/Archive
  at 12px, Save/Cancel/Archive sharing the same footer y-position, overlap
  helper aligned with Add time, and no horizontal overflow.
- Browser QA: authenticated in-app browser at 390x844 verified 0px Details
  alignment delta, 12px stacked footer actions, 20px overall percentage, and no
  horizontal overflow.

Remaining risk:
- This local polish pass has not been pushed to hosted production yet.

### UX tickets 048-052 baseline correctness pass

Status: complete.

Implementation summary:
- Completed Ticket 048 by running a browser-based reproduction and triage pass
  over the highest-risk Settings, Timeline, Needs Decision, first-run,
  reminder-readiness, import/restore, deletion, and mobile journeys using the
  local dev server plus design-system previews. `docs/UX_RESEARCH_LOG.md` now
  records observed results, ticket ownership, fixed/deferred states, and
  input-dependent blockers.
- Completed Ticket 049 by preserving `/settings#timezone` while giving the
  timezone input a unique `timezone-input` id, adding concise timezone impact
  copy, and mirroring account-deletion acknowledgement plus typed-confirmation
  gates in the client disabled state while keeping server validation.
- Completed Ticket 050 by moving the first-run setup panel below the mobile
  header safe area, constraining its viewport height, and leaving dismissal
  browser-local and non-blocking for v1.
- Completed Ticket 051 by preserving scroll context for Show more days,
  keeping expanded row details inside the native disclosure, and reducing
  repeated title noise in multi-slot Timeline groups with a neutral "Multiple
  scheduled times" header.
- Completed Ticket 052 by adding Needs Decision focus trapping, Escape close,
  launcher focus restoration, factual zero-count retained-row copy, and docs
  that same-day retention covers any prior-day occurrence resolved today rather
  than only rows resolved from inside the modal.
- Follow-up approved hosted QA on 2026-07-09 found and fixed a browser push
  setup race: the client now waits for an active service worker before creating
  a PushManager subscription. `tests/push-browser.test.ts` covers the active
  service-worker wait.
- Updated `docs/UI_SPEC.md`, `docs/USER_FLOWS.md`, and `docs/PRODUCT_SPEC.md`
  so the implemented Timeline, first-run, Settings, and Needs Decision
  contracts match the code.

Verification:
- Pass: `npm run agents:check`.
- Pass: `npm run resolvers:check`.
- Pass: `npm run lint`.
- Pass: `npm run typecheck`.
- Pass: `npm run test` (56 files, 345 tests).
- Pass: `npm run build`.
- Pass: `npm run design-system:check`.
- Pass: `git diff --check`.
- Follow-up pass after hosted QA and browser push fix: Pass: `npm run
  smoke:rls`; Pass: `npx vitest run tests/push-browser.test.ts` (7 tests);
  Pass: `npm run agents:check`; Pass: `npm run resolvers:check`; Pass: `npm
  run lint`; Pass: `npm run typecheck`; Pass: `npm run test` (56 files, 346
  tests); Pass: `npm run build`; Pass: `git diff --check`.
- Earlier focused passes during the implementation: `npx vitest run
  tests/ux-ticket-049-052-ui.test.tsx`; `npx vitest run
  tests/ux-ticket-049-052-ui.test.tsx tests/timeline.resolver.test.ts
  tests/settings.service.test.ts tests/account-deletion.service.test.ts
  tests/timeline-optimistic-status.test.ts`.
- Browser QA: local design-system previews at desktop, 390px, and 320px showed
  no horizontal overflow for first-run, Timeline, Settings, and Needs Decision
  states. Needs Decision keyboard smoke verified launcher focus, open focus,
  Shift+Tab/Tab containment, Escape close, and focus return.
- Follow-up browser QA after owner approval: system Chrome against local
  dev/test-login and hosted Supabase created disposable source/target accounts,
  rendered clean-account first-run `/timeline` at desktop and 390px without
  overflow, verified Timeline status controls, downloaded a BehaviorLog bundle,
  applied create-only import into a second account, saved browser notifications
  in a persistent Chrome profile, verified denied-notification Settings copy,
  verified `/settings#timezone` anchor/label/mobile layout, and deleted the
  disposable accounts through Settings account deletion. Final test-login
  cleanup found no stale users to delete.

Remaining risk:
- Restore preview accepted a real Cadence-exported BehaviorLog bundle but
  blocked destructive restore apply because the preview contained skipped
  actions. The confirmed compatibility issue is that Cadence export emits
  schedule ids like `sch_<uuid>`, while the current restore apply path expects
  UUID core identifiers. Import create-only still succeeded with the same
  bundle. This is now tracked as Ticket 059 before claiming end-to-end restore
  apply works for Cadence-generated bundles.

### Ticket 053: Browser reminder readiness clarity

Status: complete.

Implementation summary:
- Updated the Behavior form reminder copy so browser reminders are framed as
  behavior-level intent that uses devices enabled in Settings, while tracking
  still works when the current device is not enabled or browser notifications
  are blocked.
- Added a service-worker regression test that proves notification clicks
  navigate an existing same-origin Cadence tab to the notification target,
  defaulting to the Timeline-origin path, before focusing it.
- Added a focused Reminder editor markup regression so future copy changes do
  not blur behavior intent with current-device notification readiness.
- Updated the UI spec and UX research log for the closed browser reminder
  findings.
- No schema, provider, reminder-delivery processing, new Settings surfaces,
  test-send buttons, dashboards, PWA/offline behavior, or notification
  permission prompts on page load were added.

Verification:
- Pass: `npx vitest run tests/reminder-editor-ui.test.tsx tests/push-service-worker.test.ts tests/push-browser.test.ts` (3 files, 9 tests).
- Pass: `npm run agents:check`.
- Pass: `npm run resolvers:check`.
- Pass: `npm run lint`.
- Pass: `npm run test` (58 files, 348 tests).
- Pass: `npm run design-system:check`.
- Pass: `npm run typecheck`.
- Pass: `npm run build`.

Remaining risk:
- Browser notification delivery itself was not re-smoked during this ticket.
  The existing hosted QA record already covers successful subscription save and
  production browser-push delivery; this ticket only hardened readiness copy and
  click routing coverage.

### Ticket 054: Later correction and review discoverability

Status: complete.

Implementation summary:
- Updated actionable per-behavior heatmap cells to advertise the correction
  path with an "open day review" accessible/title hint while leaving empty
  cells passive.
- Renamed the selected behavior-day review heading from generic "Review" to
  "Review selected day".
- Added Clear decision only inside behavior-date review. It returns the
  selected occurrence to Unresolved; Timeline and Needs decision do not expose
  a global Clear decision action.
- Added a static UI regression covering the heatmap review scent, selected-day
  heading, occurrence detail rows, and the scoped Clear decision path.
- Updated `docs/UI_SPEC.md`, `docs/USER_FLOWS.md`, and
  `docs/PRODUCT_SPEC.md` to match the implemented behavior.
- Did not add a global Clear decision, a history route, bulk edit, automatic
  suggestions, AI coaching, or a dense analytics dashboard.

Verification:
- Pass: focused Ticket 054 tests (4 files).
- Pass: `npm run agents:check`.
- Pass: `npm run resolvers:check`.
- Pass: `npm run design-system:check`.
- Pass: `npm run lint`.
- Pass: `npm run typecheck`.
- Pass: `npm run test` (60 files, 353 tests).
- Pass: `npm run build`.
- Pass: `git diff --check`.
- Pass: an owner-approved agent proxy browser walkthrough of the local,
  authenticated `/behaviors` review path at desktop and 390px. It did not
  mutate records or capture real-data screenshots; it is not human evidence.

Remaining risk:
- Future human TS07 evidence can further validate discovery of the behavior
  heatmap review path. It is not a blocker for Ticket 054 completion.

### Ticket 055: Portability flow comprehension hardening

Status: complete.

Implementation summary:
- Added concise task-based guidance to export download rows for JSONL, CSV, app
  JSON, and BehaviorLog.
- Relabeled the UI's JSON download as "App JSON snapshot" and documented that
  status-event history lives in BehaviorLog, not the app-native JSON snapshot.
- Surfaced unsupported-field counts and sensitive-note warning counts in the
  BehaviorLog import dry-run summary.
- Changed import and restore recent-run timestamp fallbacks from "Open" to
  "Still open" so completed rows do not read as an action.
- Tightened the import apply acknowledgement copy to "I reviewed this exact
  preview."
- Defined the accepted-preview binding contract: import apply must use one
  persisted accepted `merge_preview` run, verify matching bundle, local-data,
  and combined preview fingerprints before writing, reject stale or altered
  input, and retain the accepted preview relationship on the applied run.
- Restore preview runs now capture an explicit start time before synchronous
  preview computation and a completion time afterward, so completed previews no
  longer appear open merely because `completed_at` was omitted.
- Restore preview UI now shows high/restricted note counts and redacted
  intervention-field counts alongside the destructive-action summary.
- The local design-system bench can render accepted, stale, invalid,
  warning-heavy, and destructive import/restore states with no product writes;
  its accepted-preview action uses a bench-only server action.
- Updated `docs/EXPORT_FORMATS.md`, `docs/UI_SPEC.md`,
  `docs/USER_FLOWS.md`, `docs/PRODUCT_SPEC.md`, `docs/DATA_MODEL.md`, and
  `docs/TICKETS.md`.
- Did not add broad restore automation, hidden destructive writes, provider
  sends, admin repair tools, AI interpretation, or new product data categories.

Verification:
- Pass: `npm run test -- tests/export-panel-ui.test.tsx tests/behaviorlog-import-ui.test.tsx tests/behaviorlog-restore-ui.test.tsx tests/export.resolver.test.ts tests/behaviorlog-import.resolver.test.ts tests/behaviorlog-restore.resolver.test.ts` (6 files, 40 tests).
- Pass: `npm run agents:check`.
- Pass: `npm run resolvers:check`.
- Pass: `npm run design-system:check`.
- Pass: `npm run lint`.
- Pass: `npm run typecheck`.
- Pass: `npm run test` (60 files, 353 tests).
- Pass: `npm run build`.
- Pass: `git diff --check`.
- Pass: focused accepted-preview/restore/export suite (8 files, 68 tests).
- Pass after the restore timestamp/count/bench follow-up:
  `npm run test -- tests/behaviorlog-import-ui.test.tsx
  tests/behaviorlog-restore-ui.test.tsx
  tests/behaviorlog-restore-apply.service.test.ts` (3 files, 24 tests).
- Pass: clean local `SUPABASE_NO_TELEMETRY=1 npm run supabase -- db reset`
  through `20260709191905_bind_import_apply_to_accepted_preview.sql` and the
  next queued Ticket 057 migration.
- Pass: local Supabase type regeneration matched the checked-in schema types;
  only the generator's trailing blank line differed before replacement.
- Browser QA: local fixture bench at 1280px and 390px verified accepted-preview
  apply success through a no-write bench action, stale-local-data refusal,
  invalid-preview disabled actions, high-sensitivity acknowledgement, visible
  restore safety counts, destructive restore action disclosure without apply,
  and no page or panel horizontal overflow.
- Pass after all five-ticket integration work settled: `npm run agents:check`
  (95 invariants), `npm run resolvers:check` (152 invariants),
  `npm run design-system:check`, `npm run lint`, `npm run typecheck`,
  `npm run test` (67 files, 428 tests), `npm run build`, and
  `git diff --check`.

Remaining risk:
- Browser QA used the real import and restore components through the local
  design-system fixture bench, not the authenticated `/export` route. It made
  no product writes and is agent-proxy evidence rather than human research.
- Destructive restore apply remains outside this ticket's browser QA scope and
  was not run against the user's real account.
- Hosted deployment of
  `20260709191905_bind_import_apply_to_accepted_preview.sql` still requires
  owner authorization before the accepted-preview contract is live in the
  linked Supabase project.

### Ticket 056: Public trust and marketing comprehension

Status: complete.

Implementation summary:
- Added low-priority Trust, Privacy, and Terms links to the Astro marketing
  footer, pointing at the authenticated app's public account-information pages.
- Added `/docs.md` to the marketing `/docs` Machine files table so the visible
  page matches the generated Markdown mirror and route-manifest outputs.
- Revised Trust account-isolation copy to state the implemented Supabase Auth
  and Row Level Security ownership model without adding unsupported guarantees.
- Added a Cadence overview return link to public legal/trust pages.
- Updated legal-content regression tests and the UX research log for the fixed
  trust/legal/machine-file findings.
- Ran three independent owner-approved agent-proxy browser walkthroughs before
  and after the homepage copy correction. Initial findings consistently showed
  that Cadence and BehaviorLog could be conflated and that "open tracker" was
  ambiguous. The revised first viewport names Cadence as an open-source,
  personal tracker and BehaviorLog as the portable export file format Cadence
  reads and writes. Reruns completed discovery, portability, and pre-login
  trust tasks without material product-versus-format confusion.

Verification:
- Pass: `npm run test -- tests/legal-content.test.tsx` (1 file, 2 tests).
- Pass: `npm run marketing:build`.
- Pass: `npm run marketing:check`.
- Pass: independent browser walkthroughs before and after the homepage copy
  change, plus visual checks at desktop and 390px.
- Pass: `npm run agents:check`.
- Pass: `npm run resolvers:check`.
- Pass: `npm run lint`.
- Pass: `npm run test` (60 files, 363 tests).
- Pass: `npm run typecheck`.
- Pass: `npm run build`.
- Pass: `git diff --check`.

Remaining risk:
- The walkthroughs are owner-approved agent proxy testing, not real-user
  research. Do not claim externally validated marketing comprehension until
  independent first-time human-user testing repeats the same tasks.

### Ticket 057: Behavior definition history and portability

Status: complete.

Implementation summary:
- Added the append-only, RLS-protected `behavior_definition_events` table for
  title and description baselines and transitions. Existing behaviors receive
  a faithful baseline of their currently stored definition without inventing
  prior revisions.
- Added resolver-owned definition normalization and change planning, plus
  owner-scoped repository access.
- Behavior create and update now write the behavior and its definition event in
  one database transaction. Definition-changing and schedule-only updates both
  reject a stale stored definition; true definition no-ops do not create an
  event.
- Create-only and approved-merge imports create their behavior baseline in the
  same transaction as the behavior. Restore-specific definition transitions
  are completed by Ticket 059's atomic restore wrapper.
- Full JSON includes sorted definition history. BehaviorLog includes the
  optional `raw/cadence/behavior_definition_events.jsonl` extension with
  manifest, Markdown guidance, privacy disclosure, and export UI copy.
- Import and restore use current definitions to create local baselines or
  transitions; they do not replay earlier Cadence-only revision history from an
  exported extension.

Verification:
- Pass: focused behavior-definition, behavior-create, import-write, export,
  conformance, and RLS tests.
- Pass: clean local `SUPABASE_NO_TELEMETRY=1 npm run supabase -- db reset`
  through `20260709203154_make_behaviorlog_restore_atomic_and_idempotent.sql`.
- Pass: local Supabase TypeScript type regeneration from the reset schema.
- Pass: local export/import fixture browser checks at 1280px and 390px with no
  horizontal overflow.
- Pass after all five-ticket integration work settled: `npm run agents:check`
  (95 invariants), `npm run resolvers:check` (152 invariants),
  `npm run design-system:check`, `npm run lint`, `npm run typecheck`,
  `npm run test` (67 files, 428 tests), `npm run build`, and
  `git diff --check`.

Remaining risk:
- The backfill records each existing behavior's current stored definition at
  its original creation timestamp; it cannot reconstruct unrecorded historical
  edits from before this ticket.

### Ticket 058: Status timestamp and status history export hardening

Status: complete.

Implementation summary:
- Full JSON now includes an additive, sorted `status_events` array for exported
  occurrences while preserving unchanged current occurrence snapshots.
- The export remains backward compatible for existing snapshot readers. The
  event records preserve correction links, status semantics, recorded/effective
  timestamps, source metadata, and reason code.
- Markdown now explains that occurrence rows are snapshots and directs agents
  to status events for corrections and decision chronology. JSONL and CSV keep
  their snapshot `status_marked_at` fields without implying full history.
- The Export UI calls the JSON download an app JSON backup and names its status
  event history. No status-history UI or future source values were added.
- Manual status marks, corrections, and clears now call one owner-scoped
  database function that locks the occurrence, verifies both the expected
  snapshot status and latest-event id, updates the snapshot, appends its event,
  and performs resolver-planned pending-reminder cancellation atomically.
- Repeating the already-current resolved status is an idempotent no-op. A true
  correction links the locked latest event, including corrections after a
  prior clear; stale and ABA plans are rejected rather than corrupting the
  correction chain.
- Note-only edits remain a separate event-free update and preserve status
  timestamps. The migration does not invent internal high-confidence events
  for legacy resolved snapshots that lack one; export keeps using its explicit
  derived, medium-confidence fallback.

Verification:
- Pass: focused export, panel, status, occurrence-service, and BehaviorLog
  conformance tests (5 files, 44 tests).
- Pass: `npm run agents:check`.
- Pass: `npm run resolvers:check`.
- Pass: `npm run lint`.
- Pass: `npm run typecheck`.
- Pass: `npm run test` (60 files, 365 tests).
- Pass: `npm run build`.
- Pass: `git diff --check`.
- Pass: focused status resolver, occurrence service/repository, migration, and
  reminder tests.
- Pass: rollback-only live local SQL transaction smoke covering atomic
  snapshot/event/reminder writes, repeated taps, clear/correction linkage,
  ABA refusal, cross-owner refusal, and rollback after a forced event failure.
- Pass: clean local migration reset and regenerated Supabase TypeScript types.
- Pass after all five-ticket integration work settled: `npm run agents:check`
  (95 invariants), `npm run resolvers:check` (152 invariants),
  `npm run design-system:check`, `npm run lint`, `npm run typecheck`,
  `npm run test` (67 files, 428 tests), `npm run build`, and
  `git diff --check`.

Remaining risk:
- Some older migrations synthesized high-confidence status events for records
  they could classify at the time. This ticket deliberately does not rewrite
  existing history; new missing-event legacy snapshots are represented only by
  the export-time derived fallback.

### Ticket 059: BehaviorLog restore apply for Cadence schedule IDs

Status: complete.

Implementation summary:
- Updated restore apply payload construction to resolve accepted create actions
  with non-UUID BehaviorLog external ids to deterministic local UUIDs scoped by
  user, bundle fingerprint, record type, and external id.
- Deterministic IDs are scoped by user, bundle fingerprint, record type, and
  external id even when the external id is already UUID-shaped, preventing
  cross-account global-primary-key collisions.
- Bound the apply run to one exact accepted preview and a database-canonical
  SHA-256 of the complete restore payload. The wrapper revalidates preview,
  bundle, local-data, payload, policy, action, mapping, and destructive-target
  identities before any product write.
- Added exact absent/unchanged row preconditions, deterministic lock ordering,
  and updated-at ownership checks so data changed after preview is refused
  rather than overwritten.
- Product rows, behavior definition baselines/transitions, provenance mappings,
  and the applied-run result now commit or roll back in one database
  transaction. The previous product-write helper is hidden from app roles.
- Preserved append-only status history: restore apply supports only accepted
  status-event creates under `preserve_append_only_history`; replacement remains
  preview-only and is disabled in both service and UI.
- Added one-applied-run-per-preview idempotency. Exact retries return the stored
  result, concurrent duplicates are cancelled or reuse it, and an uncertain
  client response cannot downgrade an already-applied ledger row to failed.
- Added a regression test using a Cadence-generated BehaviorLog bundle shape
  where a schedule external id is `sch_<uuid>`, an occurrence references that
  schedule, and a status event references the occurrence.
- Documented the restore mapping rule in `docs/EXPORT_FORMATS.md` and the
  mapping-table contract in `docs/DATA_MODEL.md`.
- No provider operation, new route, cross-account write privilege, or replay of
  exported historical definition revisions was added.

Verification:
- Pass: `npm run test -- tests/behaviorlog-restore-apply.service.test.ts tests/behaviorlog-restore.service.test.ts tests/behaviorlog-restore.resolver.test.ts tests/behaviorlog-restore-rpc-migration.test.ts tests/behaviorlog-restore-ui.test.tsx` (5 files, 13 tests).
- Pass: `npm run agents:check`.
- Pass: `npm run resolvers:check`.
- Pass: `npm run lint`.
- Pass: `npm run typecheck`.
- Pass: `npm run test` (58 files, 349 tests).
- Pass: `npm run build`.
- Pass: `git diff --check`.
- Pass: focused restore resolver, apply service, UI, and migration suites.
- Pass: clean local migration reset and regenerated Supabase TypeScript types.
- Pass: rollback-only live local SQL smoke covering payload binding, atomic
  ledger completion, exact idempotent replay, and post-binding tamper refusal
  with the pending ledger preserved.
- Pass after all five-ticket integration work settled: `npm run agents:check`
  (95 invariants), `npm run resolvers:check` (152 invariants),
  `npm run design-system:check`, `npm run lint`, `npm run typecheck`,
  `npm run test` (67 files, 428 tests), `npm run build`, and
  `git diff --check`.

Remaining risk:
- Destructive restore apply was not re-run against a hosted disposable account
  after this fix. That end-to-end browser QA still needs an owner-approved
  disposable account and fresh backup workflow before claiming hosted restore
  apply is production-smoked.
- The wrapper prevents cross-account writes and protects the accepted app
  workflow from stale or altered payloads. It is not intended as a security
  boundary against an authenticated owner who already has normal CRUD access to
  that same owner's product rows.

### Ticket 060: Schedule integrity and missing occurrence repair

Status: complete.

Implementation summary:
- Added the CLI-created idempotent schedule-integrity migration. It discovers
  every empty owned schedule without hardcoded product identifiers, inserts one
  exact compatibility slot, repairs only genuinely missing Unresolved
  occurrences for repaired active schedules from the stable local creation
  anchor through the 30-day horizon, preserves existing rows/statuses, skips
  archived occurrence generation, and marks affected account horizons stale.
- Added SQL recurrence parity helpers for daily/every-N-days,
  weekly/every-N-weeks, monthly last-day fallback, and Temporal-compatible
  timezone conversion for the one-time migration contract.
- Added pure schedule-graph normalization with typed valid, repairable, and
  invalid outcomes plus explicit historical occurrence-repair planning.
  Occurrence freshness now validates active schedules even when the stored
  horizon claims coverage; empty or ambiguous graphs surface a safe error,
  best-effort record `sync_failed`, and cannot be marked fresh.
- Moved manual Behavior form create/update onto owner-scoped atomic
  `SECURITY INVOKER` RPCs. Behavior data, optional definition history, complete
  schedule graph, and stale sync state now commit or roll back together.
  Updates bind to exact definition, schedule graph, and row-version state;
  schedule-only edits still append no definition event.
- Added repository, resolver, service, migration, and rollback-only local SQL
  coverage, plus a reusable `npm run smoke:schedule-integrity:local` command.
- Updated the data-model, recurrence, resolver ownership, and hosted operations
  contracts.
- Deployed the migration and compatible application after an owner-authorized
  backup/dry-run gate, then ran the protected occurrence-sync path and verified
  the repair with aggregate SQL and authenticated production browser QA.

Verification:
- Pass: focused Ticket 060 suite (6 files, 53 tests).
- Pass: clean local `npm run supabase -- db reset` through
  `20260717161342_repair_schedule_integrity_and_atomic_behavior_writes.sql`.
- Pass: regenerated `lib/db/database.types.ts` from the clean local schema.
- Pass: rollback-only `npm run smoke:schedule-integrity:local`, covering the
  active weekly repair fixture, archived/valid graphs, preserved Completed and
  Unresolved rows, idempotent replay, atomic create/update, stale and
  cross-owner refusal, and forced create/update slot-write rollback.
- Pass: `npm run agents:check` (95 invariants).
- Pass: `npm run resolvers:check` (156 invariants).
- Pass: `npm run lint`.
- Pass: `npm run typecheck`.
- Pass: `npm run test` (68 files, 442 tests).
- Pass: `npm run build`.
- Pass: `git diff --check`.
- Pass: fresh pre-mutation user-owned full JSON export with archived behaviors
  and notes, plus a hosted `public` schema data-only SQL backup; both artifacts
  were non-empty before deployment.
- Pass: linked migration history check and `npm run supabase -- db push
  --linked --dry-run`; only
  `20260717161342_repair_schedule_integrity_and_atomic_behavior_writes.sql`
  was pending.
- Pass: owner-authorized `npm run supabase -- db push --linked --yes`; the
  Ticket 060 migration was the only applied migration.
- Pass: privacy-safe post-migration SQL proof: 37 schedules, 38 slots, zero
  empty schedules, zero active empty schedules, zero orphan/cross-owner slots,
  two repaired slots, seven exactly-once repaired occurrences, zero fabricated
  status events, zero past reminder deliveries, and one preserved Completed
  occurrence.
- Pass: protected production occurrence sync checked and synced 6 accounts
  with 0 skipped and 0 failed. Post-sync proof found 5 eligible current/future
  reminder deliveries, no past repair reminders, and one repaired account with
  a fresh horizon and no sync failure.
- Pass: Vercel production deployment
  `dpl_is4EZv6RhHrRCMAt2JRLeS3UG1Qu` reached `READY`; error-only build logs and
  the two-hour production runtime-error view reported no errors.
- Pass: authenticated production browser QA at `/timeline` and `/behaviors`.
  Needs decision exposed the two prior repaired Unresolved Friday rows; the
  2026-07-17, 2026-07-24, 2026-07-31, 2026-08-07, and 2026-08-14 rows each
  appeared once; the behavior heatmap/review exposed the repaired history and
  status/note controls; and the preserved Completed count remained 1. No
  occurrence was changed during QA.
- Pass: post-deploy `npm run smoke:rls` created and cleaned up 2 temporary
  users and verified all 6 ownership checks.
- Pass: post-deploy linked migration history is congruent through
  `20260717161342`.
- Pass with pre-existing warnings only: linked Supabase security/performance
  advisors returned no error-level finding and no Ticket 060 function warning.
  Existing warnings cover two authenticated restore `SECURITY DEFINER` RPCs,
  leaked-password protection configuration, and RLS init-plan performance on
  existing table policies; they remain outside this ticket.

Remaining risk:
- The production application was deployed from the verified local workspace by
  Vercel CLI while the Ticket 060 changes were uncommitted (`gitDirty=1`). A
  later Git-triggered deployment from the current remote `main` would not
  contain Ticket 060 until these repository changes are committed and pushed.
- The SQL data-only backup reported circular foreign-key restore-order warnings
  for two existing tables. The fresh user-owned full JSON export is the primary
  product-restorable safety artifact for this deployment.

## Needs decision retained-date copy correction

Status: complete.

Implementation summary:
- Changed the zero-unresolved label under retained prior-day date headers from
  `All decided today` to `None left to decide` so the copy describes the group
  state without calling a past date today.
- Updated the UI regression test to require the new label and reject both the
  old wording and `0 left to decide`.
- Added the retained, fully decided date-group state to the local design-system
  Needs decision preview and aligned the UI specification, user flow, and UX
  research record with the corrected wording.

Verification:
- Pass: `npm run test -- tests/ux-ticket-049-052-ui.test.tsx` (1 file, 4
  tests).
- Pass: `npm run agents:check` (95 invariants).
- Pass: `npm run resolvers:check` (156 invariants).
- Pass: `npm run design-system:check`.
- Pass: `npm run lint`.
- Pass: `npm run typecheck`.
- Pass: `npm run test` (68 files, 442 tests).
- Pass: `npm run build`.
- Pass: `git diff --check`.
- Browser QA: local design-system Needs decision preview at 1127x900 and
  390x844 rendered one `None left to decide` label, rendered no `All decided
  today` label, had no document-level horizontal overflow, and produced no
  browser warnings or errors.

Remaining risk:
- None identified. This is a copy-only product change and does not alter
  occurrence grouping, status storage, or Needs decision counts.

## Export prompt library (Ticket 061)

Status: complete.

Implementation summary:
- Added a typed static prompt module with twelve templates, one shared Cadence
  export-semantics preamble, and a DOM-independent clipboard helper.
- Added the Analysis prompts panel after the AI summary in the Export section.
  It uses unboxed native disclosure rows, format and option requirements,
  preformatted prompt text, an underlined Copy prompt action, and accessible
  copy-result feedback.
- Registered the prompt panel and copy action in the design-system manifest,
  bench previews, and generated usage map.
- Kept the feature static and UI-only. It does not alter export bundles, the
  BehaviorLog manifest, the AI summary, resolvers, services, API routes, or the
  database.

Verification:
- Pass: `npm run agents:check`.
- Pass: `npm run resolvers:check`.
- Pass: `npm run design-system:check`.
- Pass: `npm run lint`.
- Pass: `npm run typecheck`.
- Pass: `npm run test`.
- Pass: `npm run build`.

Remaining risk:
- Clipboard availability still depends on the user's browser and permission
  context; unsupported or rejected writes show Copy unavailable.

## Canonical user interaction registry

Status: complete.

Implementation summary:
- Added `interaction-registry.json` as the canonical machine-readable inventory
  of 83 implemented user interaction intents across the Astro marketing site,
  public login/account-information pages, authenticated app shell, onboarding,
  Timeline, Behaviors, Export & Import, and Settings.
- Each entry has a stable ID, surfaces and routes, UX journey links, intent,
  triggers and variants, availability, success/failure results, material side
  effects, risk and confirmation gates, implementation references, and an
  explicit test-coverage posture.
- Added `interaction-registry.schema.json` and
  `docs/INTERACTION_REGISTRY.md` for the field contract, scope, exclusions,
  maintenance workflow, and common queries.
- Added `npm run interactions:check`. The validator checks registry structure,
  unique IDs, known surfaces and journeys, every UX journey's coverage,
  implementation/test reference existence, destructive-action confirmation,
  interactive-source inventory coverage, and per-file interaction marker
  counts. `npm run agents:check` now invokes it automatically.
- Updated the agent rules, operations runbook, route-map maintenance checklist,
  and UX journey inventory to treat the registry as the interaction traceability
  source. No product UI, route behavior, resolver, service, database, or
  provider behavior changed.

Verification:
- Pass: `npm run interactions:check` (3,428 invariants, 83 interactions, 33 UI
  sources).
- Pass: `npm run agents:check` (106 invariants).
- Pass: `npm run resolvers:check` (156 invariants).
- Pass: `npm run marketing:check` (25 Astro files, 0 errors/warnings/hints;
  marketing agent-readability check passed).
- Pass: `npm run lint`.
- Pass: `npm run typecheck`.
- Pass: `npm run test` (70 files, 452 tests).
- Pass: `npm run build`. One sandboxed attempt could not reach Google Fonts;
  the authorized network retry fetched IBM Plex Sans and completed normally.
- Pass: `git diff --check`.

Remaining risk:
- Marker-count drift checks catch new interactive files and most control/event
  additions or removals. A semantic interaction change that preserves the same
  marker count still requires the documented registry update during review.

## Exhaustive interaction audit and persona guides

Status: complete.

Implementation summary:
- Froze the exact 83-interaction, 97-trigger, 55-variant, 152-case baseline at
  126 pass, 22 fail, and 4 blocked cases. The immutable pre-fix report contains
  0 P0, 6 P1, 17 P2, and 4 P3 findings.
- Implemented the P1/P2 findings. The IA-002 ownership migration is deployed,
  the compatible authenticated app build is READY in production, and IA-023's
  audited marketing build is deployed. At the original audit cutoff, IA-024
  through IA-028 were documented as the subsequent P3 frontier; Ticket 062
  later closes IA-025 through IA-028 while leaving IA-024 decision-gated.
- The original remediation retest expanded the registry additively to schema
  1.1 with 85 interactions, 101 triggers, 55 variants, and required resolvable
  `user_guidance` metadata. Its dated 156-case matrix records 144 pass, 0 fail,
  and 12 blocked cases while preserving the frozen baseline evidence
  separately. The live registry is canonical and its later structural counts
  are recorded under Ticket 062.
- Added repository-only, task-based guides for Maya, Jordan, Priya, Sam, Lina,
  Robin, and Alex. Eighty-two interactions point to user guides;
  `INT-AUTH-002` and `INT-SHELL-007` point to the internal QA appendix. No
  product route was added for documentation.
- Redacted all retained screenshots. Deleted every task-created disposable
  account, cleared task downloads and isolated-browser tabs, reset temporary
  viewport changes, and did not use a personal account or recipient.
- Google OAuth, exact-subscription push, and Sequenzy-to-AgentMail delivery were
  blocked at the frozen audit cutoff, then passed in owner-authorized follow-up
  QA on 2026-07-23. The unscoped hosted reminder queue was not invoked.

Baseline verification:
- Pass: `npm run interactions:check` (3,428 invariants, 83 interactions, 33 UI
  sources).
- Pass: `npm run test` (70 files, 452 tests).
- Baseline commit: `79b964ac76f37d7dea1e40ae7a896afea086ebb1`.
- Baseline interaction-registry SHA-256:
  `852e30ff18a2dd45d31d3d13537d7d3f65c3f43a42ee30b57bf262735cc097a0`.

Final verification:
- Pass: `npm run agents:check` (106 invariants).
- Pass: `npm run interactions:check` (4,142 invariants, 84 interactions, 34
  sources).
- Pass: `npm run resolvers:check` (157 invariants).
- Pass: `npm run design-system:check` (0 errors and 0 warnings).
- Pass: `npm run marketing:check` (0 errors, warnings, or hints).
- Pass: lint, typecheck, 523 tests in 78 files, build, and `git diff --check`.
- Blocked: `npm run supabase -- db reset`; Docker was unavailable. Later
  read-only hosted migration history confirms the IA-002 ownership migration
  is deployed.

Remaining environment limitation:
- A clean local Supabase reset still requires an available Docker engine.

## Audit follow-up: import size architecture, Unmark registration, sign-out

Status: complete.

Implementation summary:
- Wrapped the push-endpoint ownership migration in an explicit transaction so
  its table lock is valid when the hosted CLI applies statements without an
  implicit transaction. The migration was subsequently deployed.
- Bound import and restore Apply to the exact previewed archive with a raw
  SHA-256 fingerprint while transporting base64 bytes only once. Set the
  advertised and enforced bundle limit to 2 MB and the Server Action request
  ceiling to 4 MB.
- Changed BehaviorLog ZIP output to DEFLATE and added a five-year,
  ten-daily-Behavior export sanity corpus. Its 18,260 Occurrences, roughly
  500-character Notes, and status history compressed to 1,230,362 bytes
  (1.173 MiB).
- Expanded `INT-TIMELINE-007` to cover Timeline **Unmark** and Behavior review
  **Clear decision** through the same Unresolved correction and still-future
  reminder reconciliation.
- Added `INT-SHELL-008` and a POST-only Sign out route, the expanded/collapsed
  desktop and mobile-drawer controls, and the focused **Signed out.** Login
  status.

Verification:
- Pass: `npm run agents:check` (106 invariants).
- Pass: `npm run interactions:check` (4,199 invariants, 85 interactions, 34
  interaction sources).
- Pass: `npm run resolvers:check` (159 invariants).
- Pass: `npm run design-system:check` (0 errors and 0 warnings; 27 components,
  51 product usages, 4 surfaces, and 14 canonical families).
- Pass: `npm run lint`.
- Pass: `npm run typecheck`.
- Pass: `npm run test` (80 files, 537 tests).
- Pass: `npm run build` (Next.js 16.2.7; `/auth/sign-out` included in the route
  manifest). One sandboxed retry could not reach Google Fonts; the approved
  network-enabled retry fetched IBM Plex Sans and passed.
- Pass: focused worst-case test output measured the BehaviorLog ZIP at
  1,230,362 bytes (1.173 MiB).
- Pass: `git diff --check`.

Remaining risk:
- The clean local database reset remains environment-blocked while Docker is
  unavailable. Hosted migration history includes the ownership migration, and
  Vercel shows the compatible `635cdb8` authenticated app deployment as READY.

## Interaction audit P3 traceability and narrow-screen follow-up (Ticket 062)

Status: complete.

Implementation summary:
- Aligned IA-025 registry triggers and variants with exact visible labels for
  onboarding dismissal, desktop-rail controls, Behavior form cancellation,
  import apply actions, and Settings trust/legal links.
- Added IA-026 `INT-MKT-010` ownership to the marketing BaseLayout source
  inventory.
- Audited IA-027 across all 85 interactions. The live coverage posture is 59
  direct, 6 indirect, and 20 manual declarations. Direct references now point
  to focused interaction/UI tests; the checker rejects production or generator
  files as coverage evidence and distinguishes test references from repository
  check scripts.
- Fixed IA-028 with a zero-minimum Settings panel track, wrapping Profile
  identifiers, and bounded select/text-input timezone controls. Extracted the
  two timezone control variants so both responsive contracts are testable.
- Made the marketing agent-readability check tolerant of valid attributes and
  attribute ordering on `<main id="main">`, with focused regression coverage.
- Reconciled stale IA-002 and IA-023 deployment text, corrected the current
  route inventory, and kept the original interaction-audit reports clearly
  separated from the live 85-interaction, 105-trigger, 57-variant registry.
- Kept IA-024 unchanged because account-specific onboarding dismissal requires
  a product decision.

Verification:
- Read-only hosted Supabase migration history includes
  `20260722213732_enforce_single_active_push_endpoint_owner`.
- Read-only Vercel deployment history shows the authenticated app production
  deployment for commit `635cdb8d283b514b523cfbc4fc4b5bcf03394ed0`
  is `READY`.
- Read-only Vercel deployment history shows the owner-approved audited
  marketing production deployment is `READY`; its content checks are recorded
  in the interaction-audit remediation ledger.
- Pass: `npm run interactions:check` (4,295 invariants, 85 interactions, 34
  interaction sources).
- Pass: focused Ticket 062 coverage (14 files, 61 tests).
- Pass: `npm run agents:check` (106 invariants).
- Pass: `npm run resolvers:check` (159 invariants).
- Pass: `npm run design-system:check` (0 errors and 0 warnings; 27 components,
  51 product usages, 4 surfaces, and 14 canonical families).
- Pass: `npm run marketing:build` and `npm run marketing:check` (26 Astro
  files, no errors, warnings, or hints; readability check passed).
- Pass: `npm run lint`.
- Pass: `npm run typecheck`.
- Pass: `npm run test` (87 files, 563 tests).
- Pass: `npm run build` (Next.js 16.2.7).
- Pass: authenticated browser QA with a 65-character disposable identifier at
  320px and 390px. At both widths, document scroll width equaled client width,
  the Profile identifier wrapped, and no descendant exceeded the viewport.
- Pass: temporary browser viewport/tab restoration and scoped test-login
  cleanup; one disposable `cadence-test-*@example.invalid` user was deleted.
- Pass: `git diff --check`.

Remaining risk:
- IA-024 is the only unresolved interaction-audit item and remains
  product-decision-gated.
- A clean local `npm run supabase -- db reset` still cannot run because no
  Docker engine is available. Ticket 062 has no schema changes, and hosted
  migration history confirms the previously pending IA-002 migration is
  deployed.

## Locust infrastructure stress-testing roadmap (Tickets 063-066)

Status: blocked (Ticket 066 provider and staging-target gates); Tickets 063-065
complete.

Planning summary:
- Ticket 063 defines the registry-derived load-test contract, classifies every
  live interaction for load suitability, and proves public, authenticated,
  export, and real Next.js Server Action request paths locally. It forbids a
  permanent test-only product API or weakened auth/RLS boundary.
- Ticket 064 adds exact run-scoped synthetic Supabase identities, fixture
  cohorts, session preparation, integrity/cleanup scripts, public and
  authenticated read workloads, and a bounded local baseline/ramp.
- Ticket 065 adds common status, note, Behavior lifecycle, review, timezone,
  export, occurrence-sync, fake-provider reminder, and same-account contention
  workloads plus spike, soak, breakpoint, recovery, and integrity gates.
- Ticket 066 is the only hosted capacity slice. It requires an isolated
  synthetic target, explicit owner authorization, Vercel policy approval, and
  Supabase coordination where current provider guidance requires it before any
  hosted load begins.
- The roadmap treats Locust as an HTTP/infrastructure tool, not a browser or UX
  substitute. Client-only registry interactions remain covered by the existing
  browser, component, accessibility, and interaction-audit evidence.
- Identity creation and sign-in occur outside timed capacity measurements so
  Supabase Auth limits do not distort ordinary route/action results. A
  separate future profile may measure Auth only if explicitly scoped.
- Real Google OAuth, Sequenzy email, Web Push, import/restore/account-deletion
  swarms, production user data, and unapproved Vercel traffic are excluded.

Current state:
- Ticket 063 completed on 2026-07-29.
- Ticket 064 completed on 2026-07-29.
- Ticket 065 completed on 2026-07-31. Its mixed mutation, spike/recovery, soak,
  breakpoint, changed-timezone, same-account contention, protected operator,
  loopback fake-provider, integrity, RLS, artifact, and exact-cleanup
  implementation passed its authoritative full run and final repository gates.
- Ticket 066 is blocked before traffic as of 2026-07-31. Hosted traffic has not
  started. Read-only provider discovery found no dedicated Cadence Vercel
  staging project and no separate Supabase staging project. Supabase reports a
  Pro organization. The Vercel Enterprise plan, Vercel approval, exact staging
  hostname, owner authorization, traffic window and sources, cost ceiling, and
  monitoring retention are not documented.
- Ticket 066 now has a fail-closed static single-stage preflight, 23 focused
  tests, provider request templates, human checkpoints, abort/rollback/cleanup
  procedures, and a sanitized blocked-readiness report. The preflight performs
  no network request and cannot launch Locust. It rejects production reuse,
  missing provider approval, unsafe data/provider posture, automatic stage
  advance, expired or excessive traffic, missing monitoring, source mismatch,
  dirty deployment evidence, and unsafe manifest files.
- Full retry `20260731t005526z-b2e8cca38514` passed every load stage through
  changed-timezone, including a zero-failure 60-minute soak, then rejected
  contention before any write. RLS passed, all 108 completed-stage artifacts
  reconciled, exact cleanup deleted 100 of 100 users, and zero product rows
  remained.
- Standalone contention run `20260731t040008z-e71b7359d3fb` proved that an
  active, untouched prior-day Behavior still failed on raw Timeline discovery.
  Needs decision rows mount only after client dialog state opens, so the HTTP
  response contains no occurrence forms. The corrected contention user loads
  the same stable prior-day occurrence through the server-rendered selected
  behavior/day review. Its private session pair binds the exact Behavior, date,
  occurrence, owner, and expected status. The failed run passed zero-write
  integrity, RLS, 6/6 artifact reconciliation, one-user exact cleanup, and zero
  residual rows.
- Standalone run `20260731t040440z-c8b2da9f2887` proved selected-day form
  discovery, then exposed an application-level contention defect. The winning
  status action returned in 56ms, while PostgreSQL error code `40001` made
  PostgREST retry the stale loser for 64.249 seconds. The run appended exactly
  one event and passed integrity, RLS, artifact, and cleanup checks, but its
  semantic gate correctly rejected the delayed ambiguous loser.
- Migration
  `20260731041500_use_nonretryable_occurrence_contention_errors.sql` preserves
  the transactional RPC and changes its two deliberate stale-plan exceptions
  from retryable `40001` to nonretryable `P0001`. A clean local database reset
  applied the complete migration chain and verified both live exception
  markers. The repository translates only those two known structured errors
  to the documented stale-status action result.
- Post-migration diagnostic run `20260731t041025z-4d0b1c472a84` returned the
  stale loser in 59ms, proving the retry storm was removed. It remained
  rejected because the plain structured Supabase error reached the action as a
  generic message. Repository normalization and regression tests now cover
  both known stale messages and hide unknown structured database errors.
- Authoritative focused contention run
  `20260731t041227z-eeff1bbf9832` passed its five-minute stage and independent
  exact-run checker. It completed 726 requests with zero failures, p95 50ms,
  242 status-action submissions with exact semantic readbacks, zero integrity
  violations, RLS success, 6/6 artifact reconciliation, deletion of its one
  synthetic user, and zero residual rows. A fresh uninterrupted full run
  remains required before Ticket 065 can complete.
- Full run `20260731t041910z-685ce0119003` passed 18 stages through corrected
  contention, then rejected the final operator-overlap stage after eight
  seconds. The 60-minute soak completed 43,368 requests with zero failures and
  p95 88ms. Breakpoint 50 passed at p95 160ms, 75 users established a
  zero-failure p95 430ms boundary, timezone preservation verified all 27,319
  captured occurrences, and contention completed 744 requests with zero
  failures and p95 52ms.
- The final-stage failure was deterministic selector invalidation. The prior
  changed-timezone stage used the first five identities and could legitimately
  replace a future Unresolved row. Operator overlap then leased the first ten
  identities, so one fixed Timeline occurrence selector no longer existed.
  Changed-timezone traffic now refreshes and leases the final five identities;
  operator overlap retains the first ten plus its eleventh spare repair
  account. Focused plan, lifecycle, Python lease, lint, and type checks pass.
  The rejected run passed post-failure zero-violation integrity, RLS, 114/114
  artifact reconciliation, cleanup of 100/100 users, and zero residual rows.
- Focused operator run `20260731t071641z-dcfe303bd59e` completed both traffic
  stages with zero request failures, then rejected five due/past reminder
  reactivations. The protected loop began before five Daily users completed
  their startup resolve-and-Clear proof, so it sent those reminders first.
  The first protected operator loop now waits one bounded 20-second readiness
  interval; later loops keep the declared 20-second cadence.
- Replacement operator run `20260731t072654z-27ed797933e3` passed both stages
  and the independent exact-run checker. Operator overlap completed 1,464
  Locust requests with zero failures at 4.87 RPS and p95 79ms. Twenty-nine
  protected requests passed, one spare-account causal repair was proven, all
  16 fake-provider sends were unique, five exercised due/past reminders
  remained cancelled, integrity and RLS passed, all 12/12 artifacts
  reconciled, cleanup deleted 11/11 users, and zero product rows remained.
- Authoritative full run `20260731t073716z-8108c309ba98` passed all 19
  completed stages, the independent exact-run checker, RLS, integrity,
  artifact, and exact-cleanup gates. It served 101,534 Locust requests with
  zero stage failures. The 60-minute soak served 42,794 requests at 11.88 RPS
  and p95 86ms. Ramp 50 was the highest sustainable local plateau at 24.61
  RPS and p95 150ms. Breakpoint 75 established the first zero-failure latency
  boundary at 35.04 RPS and p95 450ms, so breakpoint 100 skipped as declared.
- The accepted full run preserved all 27,312 captured past or resolved
  occurrences through the changed-timezone stage. Contention completed 762
  requests with zero failures and p95 49ms. Operator overlap completed 1,434
  Locust requests with zero failures and p95 79ms. Its 27 protected requests
  proved one spare-account causal repair and accepted 191 unique loopback
  fake-provider sends with zero rejections, duplicates, or Web Push attempts.
- Final integrity found zero violations across 94,375 rows and reconciled
  9,053 appended status events. All 91 exercised due/past reminders remained
  cancelled with zero reactivations. The soak's warmed median app RSS declined
  from 494,731,264 to 481,533,952 bytes, and database connections declined
  from 22 to 21. RLS passed, all 114/114 artifacts reconciled, cleanup deleted
  100/100 synthetic users, and zero product rows remained.
- The first independent check of that unchanged run exposed a checker-only
  cohort-allocation defect. The checker validated the changed-timezone cohort
  against identities 0-4 instead of its declared 95-99 offset. The checker and
  fixture generator now apply each stage's exact identity offset. A full-suite
  regression test covers the disjoint timezone window, and the unchanged run
  passes independent verification. Final repository verification remains
  before Ticket 065 can be marked complete.
- Full mutation run `20260729t213920z-1e245694539d` reached all four ramp
  plateaus with zero request failures, then failed closed on a Locust
  shutdown-accounting mismatch: final HTML and one-use semantic receipts
  counted 154 successful/read-back Behavior restore submissions while the
  asynchronous CSV snapshot retained 152. RLS passed, all 48 completed-stage
  artifacts reconciled without orphans, exact cleanup deleted 100 of 100 users,
  and zero product rows remained. The rejected run is diagnostic only.
- Final Locust in-memory request counts now atomically replace the existing
  stage stats CSV at shutdown. Soak admission also now matches Ticket 065:
  all four ramps and a passing ramp-25 are mandatory, and soak-25 must be
  strictly below an integrity-clean recorded latency boundary or a passing
  higher plateau. Focused verification passed 131 Python tests, 55 mutation
  evidence/lifecycle tests, TypeScript, lint, and 165 agent invariants. A
  fresh uninterrupted full run is still required before completion.
- Full run `20260730t040022z-343af39cb28f` remains rejected: its 100-user
  spike hold crossed the declared failure and p95 gates. The artifact,
  integrity, RLS, and cleanup evidence passed, but a failed stress stage is not
  promotable. The focused replacement spike
  `20260730t052531z-ae1c72853fae` passed the supervised lifecycle and exact-run
  checker, including a clean 10-user recovery after the expected p95-only
  100-user stress result.
- Full run `20260730t060556z-2ac31aca9b05` passed through spike/recovery but
  stopped its soak at 3,447.135 of 3,600 seconds after one export-only session
  returned `401` at JWT rollover. `/api/export/*` now traverses the Supabase
  cookie-refresh proxy without becoming an app-screen redirect route, and
  authenticated/anonymous/invalid-cookie proxy tests preserve the export
  route's JSON `401` contract. Final Locust stats, failures, and exceptions are
  now atomically rewritten from one shutdown snapshot.
- Replacement standalone soak `20260730t083919z-a5462699b1c1` proved the auth
  correction across the full 3,600.646-second traffic stage: 43,204 requests,
  zero failures, 12.0007 RPS, p95 85ms, zero `5xx` or exceptions, exact
  semantic readbacks, zero-violation integrity, RLS pass, 36/36 retained
  artifacts, and cleanup of 100/100 users with zero residual rows. It remains
  rejected because the old RSS gate compared a 65.859 MiB cold idle trough
  before users warmed with one 312.563 MiB hot terminal sample, despite a
  554.375 MiB peak followed by substantial reclamation and database
  connections falling from 22 to 16.
- Mutation run `20260730t104504z-5c16794e5fcd` was interrupted during soak
  before it could write summary or completion evidence. Exact recovery removed
  all 100 run-scoped users and verified zero matching users afterward. The
  partial run remains unusable.
- Authoritative schema `1.1.0` standalone soak
  `20260730t154126z-1f1a904f9ca5` passed all six declared stages and the
  independent exact-run checker. Its 3,601.427-second 25-user soak served
  42,856 requests at 11.9020 RPS with zero failures, p95 110ms, exact semantic
  readbacks, zero-violation integrity, RLS pass, 36/36 retained artifacts, and
  cleanup of 100/100 users with zero residual rows. Database connections fell
  from 22 to 17.
- The accepted soak retained 722 monotonic five-second resource observations.
  Its `[5 minutes, 10 minutes)` median app RSS was 252,502,016 bytes and its
  final-five-minute median was 256,139,264 bytes. Growth was 3,637,248 bytes
  (1.4405%) against the unchanged 134,217,728-byte allowance. Both windows
  retained 60 valid samples, zero invalid samples, and maximum gaps under
  5,003ms. The independent checker recomputed and accepted the bounded-growth
  result. Legacy `1.0.0` runs remain diagnostic and cannot be retroactively
  promoted. A fresh authoritative full suite remains required.
- Full run `20260730t172728z-69ee594dc997` completed 17 stages through the
  changed-timezone profile, then failed closed before contention and operator
  overlap. The changed-timezone profile preserved all 27,150 captured past or
  resolved occurrences and passed 20 exact Settings mutation readbacks. Its
  next integrity checkpoint rejected two fewer reminder rows than the original
  fixture count. The cause was a harness invariant, not an eligible-reminder
  gap: timezone resync may replace a future Unresolved occurrence after its
  reminder became due, while documented planning semantics forbid recreating
  missing due/past deliveries.
- Mutation integrity no longer requires a monotonic total reminder count. It
  still requires every strictly future eligible reminder, rejects duplicate or
  unexpected pending rows, and now preserves the identity of every baseline
  reminder attached to a past or resolved occurrence. Focused lifecycle,
  mutation-suite, and evidence tests pass with 111 checks. The rejected run
  passed RLS, retained the exact 102/102 completed-stage artifacts, deleted all
  100 run users, and left zero product rows. A fresh full suite remains
  required.
- Full retry `20260730t203346z-c8186c148525` remains rejected. Its 100-user
  spike completed 7,682 requests with 41 loopback connection resets, a 0.53%
  failure ratio above the strict less-than-0.5% gate, and p95 5,400ms. RLS
  passed, all 60/60 completed-stage artifacts reconciled, exact cleanup deleted
  100/100 users, and zero product rows remained. The unchanged strict suite is
  being rerun; this result is diagnostic only.
- Full retry `20260730t220333z-43601180a45b` passed smoke, calibration,
  baselines, ramp, spike/recovery, the full 60-minute soak, and breakpoint
  discovery. The soak served 43,038 requests with zero failures at 11.95 RPS
  and p95 100ms. Breakpoint 50 passed at p95 140ms, while 75 users established
  the first zero-failure latency boundary at p95 380ms. Changed-timezone
  traffic also passed, but the following contention stage failed immediately
  because its seed-time current-day occurrence selector had been replaced by
  the preceding timezone resync. RLS passed, exact cleanup deleted 100/100
  users, and zero product rows remained. The rejected run is diagnostic only.
- Contention fixtures now reserve the most recent prior-day Unresolved
  occurrence on the maintainer behavior. Prior-day identities are part of the
  timezone-preservation contract and render under Needs decision, so the
  contention selector remains valid after the required timezone stage. A
  focused fixture test locks the prior-day, owner-behavior, and Unresolved
  properties. A fresh uninterrupted full run remains required.
- Full mutation run `20260729t225646z-3a40ecd7daf3` then passed smoke,
  calibration, both mixed baselines, and the 10/25-user ramp plateaus before a
  harness abort stopped ramp-100 at 232.976 of 240 seconds. The stage retained
  7,161 requests, two GET connection-reset failures, zero `5xx`, and no
  resource breach. Final request accounting matched successful mutation
  submissions, but 16 one-use semantic receipts remained pending because the
  stage ended early. Post-failure integrity and RLS passed; all 48 artifacts
  reconciled without orphans; exact cleanup deleted 100 of 100 users with zero
  residual product rows.
- The second run exposed a false runtime classification: generic loopback HTTP
  resets were treated as database refusals, and inline reentrant shutdown hid
  the triggering request and initiating reason. Generic HTTP transport loss
  now remains under the ordinary request-failure gate; the repeated database
  refusal gate requires explicit database context or an unambiguous
  capacity-refusal message. Guarded abort is now one-shot, sanitized,
  reason-retaining, and deferred until the triggering request reaches Locust
  accounting.
- Ramp run `20260730t014631z-063151d6e33e` completed calibration and all four
  plateaus, but was rejected by an incorrect aggregate due/past reminder gate.
  Its retained final counters were 100 tracked occurrences and deliveries, 102
  Clear events, 100 Unresolved occurrences, 71 cancelled deliveries, and zero
  reactivated deliveries. The old gate incorrectly required all tracked
  deliveries to be cancelled after any Clear and did not retain the unique
  exercised-occurrence count, so the artifact remains rejected.
- The corrected producer and independent checker now retain an exact
  seven-field due/past contract. Authoritative ramp run
  `20260730t023443z-b35dca7c46da` passed calibration and all four declared ramp
  stages, RLS, zero-violation integrity, the exact 30-artifact inventory,
  cleanup of 100 of 100 users with zero residual product rows, and
  `npm run load:mutation:evidence:check`. Its highest sustainable local
  plateau was 50 users at 24.1705 RPS and p95 160ms; 100 users was a
  zero-failure latency boundary at 36.8510 RPS and p95 1,600ms. Final due/past
  evidence was 100 tracked occurrences, 100 tracked deliveries, 71 unique
  exercised occurrences, 102 Clear events, 100 Unresolved occurrences, 71
  cancelled deliveries, and zero reactivations. The result is local-only and
  does not complete Ticket 065 without a passing authoritative full suite.
- `load-tests/scenarios/interaction-map.json` classifies all 85 live
  interactions exactly once; its governance validator is integrated into
  `npm run agents:check` and has mutation fixtures for missing, duplicate, and
  destructive misclassification failures.
- The independent Python tree pins Locust 2.46.2. The Ticket 063 protocol
  supervisor rejects non-loopback Cadence or Supabase targets, creates exactly
  one ordinary synthetic account, keeps the service-role key outside Locust,
  dynamically discovers the current Next.js `$ACTION_*` multipart form fields,
  and verifies cleanup. The Ticket 065 mutation supervisor instead creates the
  exact independent cohort and reserved sessions declared by its selected
  suite.
- Timeline status forms now submit the rendered `expected_status`. A replay
  whose expected state no longer matches the owner-scoped occurrence is
  rejected before the transactional RPC, while direct service callers remain
  compatible.
- The headless protocol proof completed five requests with zero failures:
  public Terms, authenticated Timeline, full JSON export, Completed Server
  Action, and stale replay rejection. Direct persistence verification found
  one explicit-user-mark event and no stale-replay event. Cleanup removed the
  exact Auth user and all owned product rows; an independent aggregate query
  found zero remaining `cadence-load-...@example.invalid` users and profiles.
- An intentionally interrupted first diagnostic run left its owner-only
  recovery file. The corrected supervisor recovered that exact account before
  the passing run, providing evidence for the bounded interrupted-run recovery
  path without a prefix or wildcard deletion.
- Generated reports and session material are ignored under
  `load-tests/.runs/`. No product API, migration, RLS bypass, provider call,
  hosted write, or production load was added.
- The Ticket 064 lifecycle provisions exact run-scoped identities, writes
  product fixtures through ordinary authenticated RLS clients, refreshes
  per-stage sessions outside statistics, leases one unique cookie jar to each
  active virtual user, and removes private session material plus every exact
  run-created user and row in `finally`.
- The five fixture cohorts cover Empty, Typical daily, Review-heavy,
  Export-heavy, and an explicitly tagged Heavy schedule profile. The full
  fixture allocated 10/60/20/10 ordinary accounts plus five reserved heavy
  accounts and passed pre/post integrity over 70,010 rows with zero violations.
- Full local run `20260729t091314z-911e90cdbcf7` passed all 10 declared stages:
  1-user smoke/warm, 5- and 10-user 10-minute baselines, bounded
  10/25/50/100-user ramps, 10-user recovery, and the separate five-user Heavy
  schedule stage. It recorded 14,354 requests, five non-`5xx` transport-status
  `0` failures below the strict 0.5% stage gate, zero unexpected `5xx`,
  cross-account markers, Locust exceptions, or resource breaches, and all 15
  normalized timed request names.
- The one-user warm p95 was 63ms, making the provisional ceiling 126ms. The
  highest stage p95 was 110ms in the tagged Heavy schedule stage. Recovery p95
  was 63ms versus the 64ms pre-ramp baseline, with zero failures in both
  stages.
- Post-load RLS smoke passed. Exact cleanup deleted all 105 users with zero
  residual product rows; an independent Auth query also returned zero matching
  synthetic users. The independent artifact audit found a `0700` report
  directory, 54 `0600` files, zero symlinks, matching digests, no private
  session directory, and no retained path, identity, cookie, token, key, or
  fixture markers.
- The sanitized baseline and local persistent-Node/shared-machine caveats are
  recorded in `docs/PERFORMANCE_SPEED_LOG.md`; the reusable workflow is in
  `docs/LOAD_TESTING_RUNBOOK.md`, `docs/OPERATIONS.md`, and
  `docs/SUPABASE_WORKFLOW.md`.
- Current official guidance reviewed on 2026-07-31 still recommends Supabase
  load testing on staging and advance support notice for heavy/prolonged hosted
  load, while Vercel load testing remains Enterprise-only and
  approval-coordinated.

Verification:
- `npx vitest run tests/load-test-hosted-preflight.test.ts` passed (one file,
  23 tests).
- `npm run load:hosted:preflight -- --manifest <missing-file>` failed closed
  before network access and omitted the requested private path from its error.
- `npm run load:mutation:full` passed for authoritative run
  `20260731t073716z-8108c309ba98` (19 completed stages, one valid breakpoint
  skip, 101,534 Locust requests, zero stage failures, integrity, RLS, 114/114
  artifacts, cleanup 100/100, and zero residual rows).
- `npm run load:mutation:evidence:check -- --run-id
  20260731t073716z-8108c309ba98` passed after the checker-only identity-offset
  correction.
- `npx vitest run tests/load-test-mutation-evidence.test.ts` passed (one file,
  35 tests).
- `npm run load:manifest:check` passed (1,632 invariants, 85 interactions, 23
  loadable).
- `npm run load:python:test` passed (138 tests).
- `npm run agents:check` passed (167 invariants).
- `npm run interactions:check` passed (4,299 invariants, 85 interactions, 34
  interaction sources).
- `npm run resolvers:check` passed (159 invariants).
- `npm run lint` passed.
- `npm run typecheck` passed.
- `npm run build` passed (Next.js 16.2.7 production build).
- `git diff --check` passed.
- `npm run test` passed (100 files, 780 tests) with loopback permission for the
  local fake-provider server.
- A clean `npm run supabase -- db reset` passed after migration
  `20260731041500_use_nonretryable_occurrence_contention_errors.sql`.

Earlier Ticket 063-064 verification:
- `npm run load:manifest:check` passed (1,632 invariants, 85 interactions, 23
  loadable).
- `npm run load:python:test` passed (43 tests).
- `npm run load:protocol:smoke` passed (one user, five requests, zero request
  failures, persistence/event/stale/cleanup gates passed).
- `npm run load:read:smoke` passed (two stages, 72 requests, zero failures,
  pre/post integrity, RLS, exact cleanup, and artifact safety).
- `npm run load:read:full` passed (10 stages, 105 identities, 14,354 requests,
  all provisional gates, pre/post integrity, RLS, exact cleanup, and artifact
  safety).
- `npm run agents:check` passed (137 invariants).
- `npm run interactions:check` passed (4,299 invariants, 85 interactions, 34
  interaction sources).
- `npm run resolvers:check` passed (159 invariants).
- `npm run lint` passed.
- `npm run typecheck` passed.
- `npm run test` passed (90 files, 613 tests).
- `npm run build` passed (Next.js 16.2.7 production build).
- `git diff --check` passed.

Next action:
- The owner must authorize dedicated synthetic-only Vercel and Supabase staging
  resources, provide Vercel Enterprise and load-approval evidence, name the
  exact staging hostname, and approve the window, sources, limits, USD cost
  ceiling, and monitoring plan. Implement the hosted-specific supervised
  provision/run/cleanup lifecycle only after those gates are concrete. Do not
  run hosted traffic or fall back to production.

## Launch cost guardrails and traffic-surge operations (Ticket 067)

Status: blocked (owner risk policy and provider authorization); local technical
implementation is complete and verified.

Implemented:

- A private, fail-closed cost-policy preflight validates current owner roles,
  ordered USD thresholds, tested primary and backup notification roles,
  provider costs and control gaps, traffic controls, monitoring signals,
  incident levels, and safe-resumption evidence. It rejects secret, payment,
  account, recipient, and raw-provider fields.
- A sanitized provider inventory records current verified facts and every
  unresolved Vercel, Supabase, Sequenzy, domain, and monitoring field.
- Structured downloads now use one atomic Supabase-backed account limit of six
  attempts per 60 seconds across formats and application instances. Denied
  downloads return `429` plus `Retry-After` before export reads.
- Independent server-only breakers can stop email sends, browser-push sends,
  reminder batches, occurrence-sync batches, or structured downloads. They
  preserve Auth, RLS, ordinary Timeline decisions, and pending reminder
  idempotency.
- Protected process routes return `503` plus `Retry-After` when their scoped
  breaker is open. Breaker logs contain only an allow-listed breaker name,
  state, reason code, and blocked count.
- The operations runbook defines separate traffic classes, privacy-safe
  monitoring, candidate Vercel log-only rules, four incident levels, rollback,
  and safe resumption.
- The zero-network technical drill covers seven surge and cost scenarios. It
  generated no provider request or billable traffic. Human proof remains
  pending.

Verification:

- Pass: clean `npm run supabase -- db reset`, including migration
  `20260801051601_add_launch_export_rate_limit.sql`.
- Pass: `npm run smoke:launch-rate-limit:local`; the first six attempts were
  allowed, the seventh was denied, authenticated direct writes were blocked,
  and the transaction rolled back.
- Pass: focused Ticket 067 coverage (10 files, 58 tests).
- Pass: `npm run launch:surge:drill -- --synthetic` (seven scenarios, zero
  network requests, no billable traffic).
- Pass: `npm run agents:check`, `npm run interactions:check`,
  `npm run load:manifest:check`, and `npm run resolvers:check`.
- Pass: `npm run lint`, `npm run typecheck`, `npm run test` (106 files, 802
  tests), and `npm run build` (Next.js 16.2.7).
- Pass: `git diff --check`.
- Pass: owner-authorized hosted migration deployment and migration-history
  verification on 2026-08-02 for
  `20260801051601_add_launch_export_rate_limit.sql`.
- Pass: compatible application commit `97ac6247e93eb8029a418266539754baf440bde0`
  reached Vercel production as deployment
  `dpl_4bDCCb3VSq5veZ7GjENt5UgWWecf` with the canonical alias assigned.

Blocking acceptance gates:

- The owner has not approved current provider plans, billing cycles, budgets,
  warning/urgent/emergency USD thresholds, maximum unplanned spend, accepted
  outage, billing roles, incident roles, or tested primary and backup alert
  delivery.
- Vercel notifications, webhook delivery, hard-limit posture, and log-only
  firewall rules remain unconfigured and untested. The team-wide project-pause
  blast radius remains an explicit owner decision.
- Supabase Spend Cap posture remains unverified. Compute and listed add-ons
  remain outside Spend Cap coverage.
- Sequenzy account allowance, account alert or cap, and manual review owner
  remain unverified.
- The non-production human tabletop, false-positive review, OAuth/Cron bypass
  proof, and firewall preview require owner participants and exact targets.
- Provider settings, production breaker environment variables, and firewall
  rules still require exact owner authorization.

The application guardrail and database migration are deployed. No provider
setting changed. No firewall rule was published. No project paused. No plan,
compute size, add-on, budget, or limit changed. No provider message was sent.

Next action:

- The owner supplies the private risk policy and exact provider authorizations.
  Run the private preflight, configure only approved controls, test alert
  delivery and log-only rules, then complete the human drill and sanitized
  acceptance report.

## Occurrence stopwatch capture, reset, and persistence (Ticket 068)

Status: complete.

Scope:

- Add one additive `occurrence_time_sessions` migration with no backfill or
  mutation of existing product rows.
- Add resolver-first start, stop, duration, multiple-session, and reset logic
  with owner-scoped repositories, services, RLS, and generated types.
- Add Track Time, Stop, persisted refresh recovery, combined occurrence time,
  and Reset tracked time to the existing expanded Timeline occurrence row.
- Keep time tracking separate from occurrence status and reminders.
- Update product, data, UI, user-flow, decision, route, resolver, interaction,
  load-manifest, and user-guide contracts during implementation.

Dependencies:

- Ticket 068 is independent of Tickets 066-067. Its implementation and hosted
  migration deployment are complete.

Verification:

- Pass: local `npm run supabase -- db reset`, including
  `20260802000000_add_occurrence_time_sessions.sql` with no timing-session
  backfill.
- Pass: regenerated local Supabase types match
  `lib/db/database.types.ts` apart from a final generated newline.
- Pass: focused Ticket 068 resolver, service, repository, migration, RLS, and
  Timeline UI coverage (22 tests).
- Pass: `npm run agents:check`, `npm run interactions:check`,
  `npm run load:manifest:check`, `npm run resolvers:check`,
  `npm run design-system:check`, `npm run lint`, `npm run typecheck`, and
  `npm run build`.
- Pass: `npm run test` (111 files, 820 tests) with local loopback permission
  for the existing fake-provider test server.
- Pass: `git diff --check`.

Hosted migration state:

- Migration `20260802000000_add_occurrence_time_sessions.sql` reached the
  linked hosted Supabase project on 2026-08-02 after owner authorization.
- Authenticated production Timeline QA loaded the new table and exposed Track
  Time on an active current-day occurrence without creating a timing session.

Remaining risk:

- No Ticket 068 schema deployment risk remains.

## Needs decision timing and timer-label refinement

Status: complete.

Scope:

- Expose Track Time for active-behavior occurrences still visible in Needs
  decision while preserving server-side rejection for future, archived, and
  expired resolved occurrences.
- Remove the duplicate static Track time heading from idle and stopped timer
  states. Keep the static, non-underlined label only while a session runs.
- Update resolver-owned eligibility, Timeline UI, design-system previews,
  product contracts, guidance, and regression coverage.

Implementation notes:

- `time-tracking.resolver.ts` now owns start eligibility for current-day and
  visible Needs decision occurrences. Timeline rendering and the timing service
  consume the same rule.
- Idle and stopped timer states render one Track Time action. Running state
  renders a static Track time label above the counter, Stop, and Reset tracked
  time.
- The design-system bench now demonstrates idle, running, and stopped states
  across unresolved, Completed, and Not Completed row tones.

Verification:

- Pass: focused time-tracking resolver, service, Timeline resolver, and Timeline
  UI coverage (4 files, 26 tests).
- Pass: `npm run agents:check`, `npm run interactions:check`,
  `npm run load:manifest:check`, `npm run resolvers:check`,
  `npm run design-system:check`, `npm run lint`, `npm run typecheck`,
  `npm run test` (111 files, 842 tests), and `npm run build`.
- Pass: desktop 1280px and mobile 390px design-system QA verified one idle
  Track Time action, a non-underlined running label, contrast-aware row tones,
  and no horizontal overflow. The prior Needs decision row rendered Track Time
  on both viewports.

Remaining risk:

- The fixed Needs decision launcher remains clipped inside its contained bench
  trace preview, so browser QA inspected the same `needs_decision` occurrence
  through the OccurrenceRow preview. Direct UI coverage renders the
  `needsDecisionDialog` TimelineGroup variant with Track Time.

## Behavior timing averages and selected-day review (Ticket 069)

Status: complete.

Scope:

- After Ticket 068, add a conditional Average tracked time line to behavior
  outcome metadata using the selected 7, 30, or 90-day range.
- Sum stopped sessions per occurrence, then average only timed occurrence
  totals. Exclude untimed and running-only occurrences.
- Add conditional Tracked time content to Review selected day and reuse Reset
  tracked time inside the existing Review disclosure.
- Add no history disclosure, chart, table, pop-up, modal, route, or empty
  placeholder.

Dependencies:

- Ticket 068 is complete and its hosted migration is deployed.

Verification:

- Pass: focused `tests/analytics.resolver.test.ts`,
  `tests/time-tracking.service.test.ts`, and `tests/behavior-review-ui.test.tsx`
  (26 tests).
- Pass: `npm run agents:check`, `npm run interactions:check`,
  `npm run load:manifest:check`, `npm run resolvers:check`,
  `npm run design-system:check`, `npm run lint`, `npm run typecheck`,
  `npm run test`, and `npm run build`.
- Pass: `git diff --check`.

Implementation notes:

- Behaviors loads timing sessions in one owner-scoped repository read for the
  selected occurrence range. The analytics resolver sums stopped sessions per
  occurrence, excludes running-only and untimed occurrences, formats values,
  and derives the selected-range average.
- Review selected day conditionally shows recorded time and/or In progress. Its
  existing Review disclosure now reuses the time-tracking reset service and
  refreshes both Behaviors and Timeline without changing Status or Note.

Remaining risk:

- Authenticated production Behaviors QA loaded the timing-aware analytics path
  successfully. No Ticket 069 deployment blocker remains.

## Privacy-gated time-tracking exports (Ticket 070)

Status: complete.

Scope:

- After Tickets 068-069, add an unchecked Include time tracking option to
  Export & Import using `include_time_tracking=1` as the only enabling query
  value.
- Disabled exports must not read or expose timing data and must preserve all
  existing artifact shapes.
- Enabled exports add scoped raw sessions and derived durations to Full JSON,
  JSONL, CSV, BehaviorLog, filenames, selected-range context, and Markdown as
  defined in `docs/TICKETS.md`.
- BehaviorLog timing data remains an optional Cadence export-only file; import
  and restore validate and disclose it but do not replay it in this ticket.

Dependencies:

- Tickets 068 and 069 are complete. Ticket 070 reuses their settled
  persistence, reset, duration, and aggregation semantics.

Verification:

- Pass: focused export resolver, service, page, route, BehaviorLog
  conformance, import, and restore tests (78 tests). Coverage includes exact
  opt-in parsing, disabled repository no-call, deterministic session ordering,
  range and archived filtering, CSV escaping, optional-file hashing, and
  export-only import/restore behavior.
- Pass: `npm run agents:check`, `npm run interactions:check`,
  `npm run load:manifest:check`, `npm run resolvers:check`,
  `npm run design-system:check`, `npm run lint`, `npm run typecheck`,
  `npm run test` (111 files, 838 tests), `npm run build`, and
  `git diff --check`.
- Pass: authenticated production Export QA confirmed the option is unchecked by
  default, default download links omit timing, and the exact opt-in URL adds
  `include_time_tracking=1` to all four download links plus the timing count.
- Pass: Vercel deployment `dpl_4bDCCb3VSq5veZ7GjENt5UgWWecf` is `READY` for
  commit `97ac6247e93eb8029a418266539754baf440bde0`, owns the canonical alias,
  and showed no runtime error logs or `5xx` responses in the post-deploy scan.

Implementation notes:

- Default exports never query `occurrence_time_sessions`. The exact
  `include_time_tracking=1` option scopes the owner read to occurrences already
  selected by range and archived-behavior filtering.
- Enabled Full JSON, JSONL, CSV, BehaviorLog, filenames, selected-range
  summary, and Markdown include timing with stopped-only duration aggregates.
  BehaviorLog uses an optional hashed Cadence extension file.

Remaining limitation:

- Time-session history remains export-only. Import and restore validate the
  optional Cadence file and hash but do not replay timing sessions.
- Authenticated Chrome QA reproduced a React hydration warning on both the
  prior and current deployments. It did not block Timeline, Behaviors, Export,
  or the option flow; its root cause remains unverified.

## Mobile Timeline refresh and completion-feedback regressions (Ticket 071)

Status: complete.

Implemented:

- Wrapped the current-day and future Timeline feed in a mobile-only gesture
  controller. It starts only at the document top, ignores interactive controls,
  locks to downward movement, uses a 72px threshold, prevents native overscroll
  after the lock, and allows one route refresh while a refresh is in flight.
- Added restrained `Pull to refresh`, `Release to refresh`, and
  `Refreshing timeline` live feedback. The gesture adds no mutation, route,
  service worker, offline cache, or permanent toolbar.
- Added the duplicate-chime harness before the playback fix. The corrected
  pre-fix harness failed because one guarded mobile activation created two
  `HTMLAudioElement.play()` paths: the muted gesture primer and the confirmed
  post-success playback. One status submission still occurred.
- Removed the separate media-element primer. Gesture preparation now resumes
  and primes Web Audio only. The confirmed success path owns the single media
  playback attempt and keeps the existing Web Audio and synth fallbacks.
- Anchored resolved labels and unresolved action controls to the 48px summary
  line. Expanded details no longer enlarge the alignment row and push the
  Completed or Not Completed label downward.
- Added the supplied evidence at
  `docs/qa/ticket-071/timeline-collapsed.png` and
  `docs/qa/ticket-071/timeline-expanded-status-misalignment.png`.
- Updated product specs, user flows, route ownership, user guidance,
  interaction traceability, load classification, the design-system contract,
  Timeline fixtures, and design-system inventories.

Verification:

- The focused regression set passed 31 tests across pull gestures, Timeline
  wiring, expanded-row alignment, status submission, and completion feedback.
- Connected Chromium touch emulation at 390px showed the below-threshold and
  ready feedback states. Releasing after 92px showed `Refreshing timeline` and
  issued one Timeline React Server Component request.
- The Chromium status fixture recorded one `HTMLMediaElement.play()` attempt
  and one `cadence:completion-chime-played media` event for one Completed click.
- Expanded Completed rows measured zero status/title center drift at 390px and
  desktop. The 320px measurement differed by 0.004px from subpixel rounding.
- `npm run agents:check` passed 178 invariants.
- `npm run interactions:check` passed 4,498 invariants across 88 interactions
  and 37 interaction sources.
- `npm run load:manifest:check` passed 1,665 invariants across 88 interactions
  and 23 loadable interactions.
- `npm run resolvers:check`, `npm run design-system:check`, `npm run lint`,
  `npm run typecheck`, and `git diff --check` passed.
- `npm run test` passed 856 tests across 114 files. The first sandboxed run
  failed only because the fake Sequenzy tests could not bind a loopback port;
  the authorized rerun passed.
- `npm run build` passed.

Remaining limitations:

- Physical audibility on the reported phone is not verified. The automated
  evidence proves the removed duplicate media playback attempt and the
  exact-once playback-start event.
- Mobile WebKit was unavailable. The connected browser supplied Chromium only.
- The authenticated `/timeline` route redirected to Login because the guarded
  local test-login environment was not enabled. Browser QA used the
  fixture-backed design-system route that renders the production components and
  the real server-action success path without changing product data.

## Profile email integrity and reminder recipient trust (Ticket 079)

Status: complete locally.

Implemented:

- Added migration
  `20260825061411_protect_profile_email_and_reminder_delivery_state.sql`.
- Removed authenticated profile insert, table-wide update, and delete grants.
  Authenticated clients retain profile select and may update only `timezone`.
- Added an Auth email-update trigger that synchronizes `profiles.email` from
  `auth.users.email`, matching the existing account-creation source of truth.
- Added a reminder-delivery before-update guard. Non-`service_role` callers
  cannot move `sent` or `failed` deliveries to `pending`, or clear a non-null
  `processing_started_at` claim.
- Preserved user-scoped pending planning, cancellation, and unclaimed
  cancelled-delivery reactivation. The server-only processor retains the
  `service_role` maintenance exception.
- Extended the authenticated RLS smoke with profile timezone and protected
  identity-field writes, Auth email propagation, reminder planning,
  cancellation, reactivation, terminal recycling, and claim-clearing proof.
- Updated the data and notification contracts. Added a static migration
  permission and trigger regression test.
- Database types were not regenerated. The migration changes privileges and
  trigger behavior only; it adds no Data API row or callable RPC type shape.

Verification:

- Pass: focused Ticket 079 coverage with
  `npm run test -- tests/profile-email-reminder-integrity-migration.test.ts tests/supabase-function-permissions-migration.test.ts tests/rls-smoke-script.test.ts tests/reminder.service.test.ts tests/occurrence.service.test.ts tests/settings.service.test.ts`
  (6 files, 68 tests).
- Pass: clean `npm run supabase -- db reset` through the Ticket 079 migration.
- Pass: `npm run smoke:rls:local` created and cleaned three temporary users and
  verified 51 ownership and integrity checks through ordinary authenticated
  clients. The local stack required restarting only its stopped PostgREST and
  API gateway containers after reset.
- Pass: `npm run agents:check` (178 invariants),
  `npm run interactions:check` (4,484 invariants), and
  `npm run resolvers:check` (169 invariants).
- Pass: `npm run lint`, `npm run typecheck`, `npm run test` (123 files passed,
  1 skipped; 953 tests passed, 1 skipped), and `npm run build`.
- The first sandboxed full-test run failed only because the existing fake
  Sequenzy tests could not bind `127.0.0.1`. The approved loopback-capable
  rerun passed without source changes.
- Pass: `git diff --check`.

Rollout status and remaining risk:

- No hosted migration, provider operation, deployment, email send, commit, or
  push occurred. Hosted migration deployment remains unauthorized.
- Production remains vulnerable until the owner authorizes the migration-first
  hosted rollout and the same authenticated RLS smoke passes against that
  target.

## Reminder pipeline claim recovery and channel isolation (Ticket 080)

Status: complete locally.

Implemented:

- Made pending reminder claims strictly older than 15 minutes due and
  reclaimable. Due selection and conditional claim updates share the same
  predicate, so concurrent workers cannot both win one abandoned claim.
- Classified successful abandoned-claim recovery as a retry and added a
  privacy-safe monitoring event containing only the channel and retry flag.
- Added 10-second `AbortSignal.timeout` bounds at email, browser-push, and
  reminder-service provider boundaries. Web Push also uses the matching SDK
  socket timeout. Timeouts follow the existing delivery-failure path.
- Made sent updates conditional on `status = 'pending'` and return whether a
  row changed. A zero-row result leaves a mid-flight cancellation intact,
  emits privacy-safe monitoring, and increments cancelled instead of sent.
- Constructed the Sequenzy sender only after a due-email query returns rows.
  Missing email configuration now fails claimed due emails while browser push
  continues. Email and browser-push channel processing starts concurrently.
- Added focused repository, orchestration, provider-timeout, cancellation,
  concurrent-reclaim, monitoring, and channel-isolation coverage. Updated the
  notification contract. No schema or generated database type changed.

Verification:

- Pass: focused Ticket 080 coverage with
  `npm run test -- tests/reminder-deliveries.repo.test.ts tests/reminder.service.test.ts tests/sequenzy.service.test.ts tests/web-push-subject.test.ts`
  (4 files, 40 tests).
- Pass: `npm run agents:check` (178 invariants),
  `npm run interactions:check` (4,484 invariants), and
  `npm run resolvers:check` (169 invariants).
- Pass: `npm run lint`, `npm run typecheck`, `npm run test` (123 files passed,
  1 skipped; 961 tests passed, 1 skipped), `npm run build`, and
  `git diff --check`.
- The first sandboxed full-test run failed only because the existing fake
  Sequenzy tests could not bind `127.0.0.1`. The approved loopback-capable
  rerun passed without source changes.

Rollout status and remaining risk:

- No schema change, database reset, hosted mutation, provider operation,
  deployment, notification send, commit, or push occurred.
- Production retains the old reminder processor until the owner authorizes an
  application deployment. The local tests use deterministic repository and
  provider fakes; hosted reminder processing remains unverified in this task.

## Complete reads for export and restore (Ticket 081)

Status: complete locally.

Implemented:

- Added one shared PostgREST range-read helper with fixed 1,000-row pages,
  exact-page continuation, deterministic caller ordering, duplicate and
  non-advancing-page rejection, page-error propagation, and a fail-loud
  100,000-row absolute ceiling.
- Routed complete user-scoped reads for Behaviors, Behavior schedules, schedule
  slots, Occurrences, Occurrence status events, imported Notes, BehaviorLog
  record mappings, and imported interventions through the helper. Schedule
  rows are reassembled instead of relying on capped embedded arrays.
  Status-event reads normalize and batch Occurrence IDs before restoring global
  `recorded_at`, `id` order.
- Reused the helper for Ticket 094 arbitrary-ID and retention-presence
  time-session response ranges without changing its owner-scoped RPC batching,
  deduplication, or global ordering.
- Preserved Ticket 094 historical time-session and Ticket 095-097 definition
  and configuration fixed-high-water keyset semantics. Added the same absolute
  ceiling plus duplicate or non-advancing cursor rejection. Definition and
  configuration history reads now also fail when a captured high-water row is
  not reached before pagination returns an empty page.
- Kept the main Export-page RPC unchanged because it returns one JSON row.
  Manifest and summary counts continue to derive from fully materialized arrays.
- Added focused helper, repository, restore-graph materialization, and Export
  service coverage. A 1,001-definition-event and 1,001-time-session export now
  proves the true BehaviorLog manifest counts.
- Reused Ticket 094's 2026-08-12 local and hosted `max_rows = 1000` evidence.
  No hosted inspection or mutation occurred.

Verification:

- Pass: focused Ticket 081 coverage with
  `npm run test -- tests/behaviorlog-import-ui.test.tsx tests/complete-reads.repo.test.ts tests/paginated-read.test.ts tests/export.service.test.ts tests/time-sessions.repo.test.ts tests/behavior-definition-events.repo.test.ts tests/behavior-configuration-events.repo.test.ts`
  (7 files, 66 tests).
- Pass: focused import-write fake-repository compatibility coverage with
  `npm run test -- tests/behaviorlog-import-write.service.test.ts tests/behaviorlog-import-intervention-history.test.ts`
  (2 files, 24 tests).
- Pass: `npm run agents:check` (178 invariants),
  `npm run interactions:check` (4,484 invariants), and
  `npm run resolvers:check` (169 invariants).
- Pass: `npm run lint`, `npm run typecheck`, `npm run test` (125 files passed,
  1 skipped; 978 tests passed, 1 skipped), `npm run build`, and
  `git diff --check`.
- The first sandboxed full-test run also exposed missing `.range()` support in
  two in-memory Supabase fakes. Those fakes now model range slicing. The final
  loopback-capable full run passed.
- No migration or schema change was introduced, so the local Supabase database
  reset was not required for Ticket 081.

Rollout status and remaining risk:

- No hosted mutation, provider operation, deployment, email send, commit, or
  push occurred.
- Reads above 100,000 rows now stop with a clear error by contract. A future
  larger-account strategy must change that explicit ceiling before export or
  restore can proceed.

## Settings write atomicity and account-deletion ordering (Ticket 083)

Status: complete locally.

Implemented:

- Reordered account deletion to validate both gates, construct and verify the
  server-only client with `admin.getUserById`, hard-delete the Auth user, then
  attempt global sign-out. Client construction, verification, thrown provider
  failures, and returned delete errors now produce specific recoverable
  messages before any session mutation.
- Kept a post-delete sign-out error on the success path. Auth hard deletion has
  already removed Auth session rows and refresh capability, so the application
  redirects to Login instead of presenting an impossible deletion retry.
- Added explicit expiration for every current `sb-*-auth-token*` cookie after
  deletion. This prevents an issued JWT left by a failed SDK sign-out from
  redirecting the success destination back into the protected app.
- Reused the Ticket 095-097 owner-scoped timezone function. It updates the
  profile, every active Behavior, configuration history, and the stale sync
  ledger inside one transaction. Occurrence sync remains outside and
  rerunnable.
- Added migration
  `20260825075255_fix_settings_timezone_conflict_errors.sql`. It preserves the
  complete history-aware function and changes its stale profile, active-set,
  and Behavior precondition errors from retryable `40001` to non-retryable
  `P0001`.
- Extended the authenticated local RLS smoke. A deliberately stale Behavior
  timestamp fails only after the profile update statement executes, then
  follow-up reads prove transaction rollback. A valid retry proves one profile
  update, one Behavior update, one configuration event, and exactly one
  sync-state version increment. A stale-profile retry performs no write.
- Updated `INT-SETTINGS-003` and `INT-SETTINGS-009`, account/timezone source
  docs, the user guide, and the Supabase workflow to match observed ordering,
  rollback, retry, and access-token semantics.

Verification:

- Pass: focused Ticket 083 coverage with
  `npm run test -- tests/account-deletion.service.test.ts tests/settings.service.test.ts tests/settings-timezone-atomicity-migration.test.ts tests/behavior-configuration-events-migration.test.ts tests/rls-smoke-script.test.ts tests/ux-ticket-049-052-ui.test.tsx`
  (6 files, 44 tests).
- Pass: explicit returned/throwing sign-out cleanup and auth-cookie expiration
  coverage with
  `npm run test -- tests/account-deletion.service.test.ts tests/supabase-server-cookies.test.ts`
  (2 files, 10 tests).
- Pass: clean `npm run supabase -- db reset` through the Ticket 083 migration.
- Pass: `npm run smoke:rls:local` created and cleaned three temporary users and
  verified 56 ownership and transaction checks.
- Pass: generated local database types match `lib/db/database.types.ts` except
  for one trailing blank line. The function signature did not change.
- Pass: local Supabase security advisors at warning level and performance
  advisors at error level reported no issues.
- Pass: `npm run agents:check` (178 invariants),
  `npm run interactions:check` (4,506 invariants), and
  `npm run resolvers:check` (169 invariants).
- Pass: `npm run lint`, `npm run typecheck`, `npm run test` (128 files passed,
  1 skipped; 1,000 tests passed, 1 skipped), `npm run build`, and
  `git diff --check`.
- The final sandboxed build rerun failed only because the configured Google
  font fetch lacked network access. The approved network-capable rerun passed
  without source changes.
- Two pre-migration smoke attempts returned gateway timeout. Local Postgres
  logs showed the intended stale-Behavior exception repeating under SQLSTATE
  `40001`. Both attempts ran exact temporary-user cleanup. The non-retryable
  migration removed the retry storm, and the final smoke passed in 4.8 seconds.

Rollout status and remaining risk:

- No hosted migration, provider mutation, deployment, notification send,
  commit, or push occurred. Hosted migration and application deployment remain
  unauthorized.
- Supabase Auth hard deletion removes Auth session rows and refresh capability.
  Already-issued stateless access-token JWTs can remain valid until `exp`, and
  global sign-out cannot retroactively revoke them. The configured JWT lifetime
  bounds this residual window.

## Governance checks, environment contract, and database operations (Ticket 093)

Status: complete locally.

Implemented:

- Upgraded the interaction registry to schema `1.2.0`. Optional
  `effect_checks` bind a recorded effect to a named handler and stable evidence
  inside that handler. The Note-write contract is the first fully mechanical
  entry. A deliberately altered delete handler remains a negative fixture.
- Replaced headline invariant totals with factual checker scope. The
  interaction checker reports mechanically checked entries separately from
  entries requiring human side-effect review. The current result is 1 checked
  entry and 87 human-review entries, with every unchecked effect listed.
- Extended resolver caller checks to reject direct `.rpc(` and `.upsert(` use
  under `app` and `components`. Both bypasses have negative fixtures.
- Replaced the fixed environment-variable allowlist with a source-derived scan
  across app, component, library, marketing, and script source. `.env.example`
  now documents every discovered variable, including routing fallbacks,
  performance flags, design-system tooling, and supervised load-test values.
  The missing-variable behavior has a negative fixture.
- Added CLI-created migration
  `20260825080815_add_occurrence_sync_batch_order_index.sql`. Its composite
  index matches the daily sync batch order exactly.
- Added a post-`20260825075255` migration governance boundary. New migrations
  with a backfill or `SET NOT NULL` require explicit `BEGIN` and `COMMIT`.
  Historical applied migrations remain unchanged. An unsafe backfill is a
  negative fixture.
- Updated the Vercel workflow with both scheduled jobs. Updated
  `INT-SETTINGS-004` so denied permission still exposes Refresh this device.
- Added a 10-creation per-process test-login quota. Failed creation or a
  successfully cleaned failed sign-in releases its reservation. Operators now
  clean temporary users after each QA run and daily while test login is
  enabled.

Verification:

- Pass: focused Ticket 093 coverage with
  `npm run test -- tests/test-login.test.ts tests/test-login-cleanup-script.test.ts tests/occurrence-sync-batch-index-migration.test.ts`
  (3 files, 13 tests).
- Pass: checker positive and negative fixtures through `npm run agents:check`,
  `npm run interactions:check`, and `npm run resolvers:check`.
- Pass: clean `npm run supabase -- db reset` through the Ticket 093 migration.
- Pass: local `EXPLAIN` with sequential scans disabled selected an index-only
  scan through `occurrence_sync_state_batch_order_idx` for the exact repository
  ordering and `LIMIT 25`.
- Pass: local Supabase advisors for the affected `public` schema reported no
  errors. The all-schema advisor command still reports the pre-existing
  Ticket 060 temporary-table helper error in `cadence_private`; Ticket 093 did
  not change that function.
- Pass: `npm run lint`, `npm run typecheck`, `npm run test` (129 files passed,
  1 skipped; 1,003 tests passed, 1 skipped), `npm run build`, and
  `git diff --check`.
- The first sandboxed build failed only because `next/font` could not fetch IBM
  Plex Sans. The approved network-capable rerun passed without source changes.

Rollout status and remaining risk:

- No hosted migration, provider mutation, deployment, notification send,
  commit, push, or GitHub mutation occurred. Hosted migration and application
  deployment remain unauthorized.
- The 87 explicitly listed human-review interaction entries remain outside
  mechanical side-effect verification. The checker does not count them as
  mechanically checked.

## Owner-scoped time-session query transport (Ticket 094)

Status: complete.

Implemented:

- Added authenticated-only, owner-scoped arbitrary-ID and historical
  time-session RPCs. Both are `STABLE`, `SECURITY INVOKER`, use an empty
  `search_path`, retain RLS, and return six minimal columns.
- Added the EXPLAIN-backed `(user_id, started_at, id)` time-session index.
- Replaced the oversized direct table read with sequential 2,000-ID batches,
  1,000-row response continuation, deduplication, stable global ordering, and
  non-advancing-page rejection.
- Added 1,000-row keyset history paging with one fixed high-water instant and
  non-advancing or regressing cursor rejection.
- Routed Analytics and optional time-tracking Export reads through joined
  local-date history. Timeline and single-Occurrence reads remain on the
  arbitrary-ID path.
- Regenerated database types and added migration, repository, Analytics,
  Timeline, Export, and RLS smoke coverage.
- Added `npm run smoke:rls:local`. It reads CLI-reported local credentials,
  requires a loopback URL, and cannot inherit a hosted URL from `.env.local`.

Verification:

- Pass: clean `npm run supabase -- db reset` through migration
  `20260812172823_add_time_session_query_rpcs.sql`.
- Pass: regenerated local database types match `lib/db/database.types.ts`
  apart from a trailing blank line.
- Pass: loopback `npm run smoke:rls:local` created and cleaned two temporary
  users and verified 23 table, RPC ownership, archive, high-water, cursor,
  validation, and anonymous-denial checks.
- Pass: a local Data API spike returned 1,001 unique rows through `[1000, 1]`
  pages for both RPCs.
- Pass: local Supabase security advisors at warning level and performance
  advisors at error level reported no issues.
- Pass: `npm run agents:check` (178 invariants),
  `npm run interactions:check` (4,484 invariants), and
  `npm run resolvers:check` (169 invariants).
- Pass: `npm run lint`, `npm run typecheck`, `npm run test` (117 files, 882
  tests), `npm run build`, and `git diff --check`. The first sandboxed full-test
  run failed only because fake-provider tests could not bind loopback; the
  authorized rerun passed.

Rollout status:

- The owner authorized hosted migration and application deployment on
  2026-08-12. Preflight found only Ticket 094 pending in hosted migration
  history. `npm run supabase -- db push --linked --yes` applied migration
  `20260812172823_add_time_session_query_rpcs.sql`. A final dry run reported the
  hosted database up to date.
- Hosted inspection confirmed both exact signatures, `STABLE` invoker mode,
  empty search paths, the new index, and execute permission for
  `authenticated` only. Hosted migration history matches git through
  `20260812172823`.
- Hosted `npm run smoke:rls` passed all 23 ownership, archive, high-water,
  cursor, validation, and anonymous-denial checks through ordinary clients.
  Both hosted smoke runs cleaned their two temporary users.
- A disposable 1,001-session hosted fixture confirmed `max_rows = 1000`. The
  unpaged arbitrary-ID RPC returned 1,000 rows. Arbitrary-ID response ranges
  and history keyset pages both returned `[1000, 1]` without gaps or
  duplicates. Cleanup removed the temporary user, and an aggregate auth query
  confirmed zero matching users remained.
- Commit `a0fd750e3a936067c2142de350f43f9cfca559cb` reached production through
  Vercel deployment `dpl_H2S7N2td7K62iAQ35S7ABQFXrs1q`. The deployment is
  `READY` and serves the canonical `cadence-blush-three.vercel.app` alias.
- Authenticated production QA passed Behaviors ranges 7, 30, and 90. The
  90-day range rendered 666 occurrences and timing analytics without the prior
  `Bad Request`. Timeline rendered its Track Time control. Export rendered six
  timing sessions with `include_time_tracking=1` across every download link.
- Vercel reported no post-deployment runtime error clusters, 5xx responses, or
  recurrence of digest `2953342693@E394`. Chrome still reported the pre-existing
  React hydration warning documented under Ticket 070; it did not block any
  Ticket 094 route.
- One verification attempt inherited the hosted `.env.local` target before the
  loopback-only command existed. It created two temporary smoke users, stopped
  at the missing RPC, and ran cleanup. A read-only follow-up confirmed zero
  `cadence-rls-smoke-*` users remained. No hosted schema changed.

## Public repository security release gate (Ticket 098)

Status: complete. The audited release decision is PASS.

Ticket 098 cleared the public-repository security release gate. The audited
executable commit is `6c07538f13df1a358bd8902383b9f109e4da0509` with parent
`57171c3f17b32b83acd60b31a27938c856675731`. The commit containing this PASS
record changes only `STATUS.md` and `docs/PUBLIC_REPOSITORY_RELEASE.md` from
that executable commit. Its exact hash belongs in the external release
handoff, which avoids a self-referential commit claim.

Verification complete:

- Pass: private GitHub `main` contains the authorized history rewrite and the
  executable commit. The repository remains private and unarchived. It has one
  branch, no tags, no issues, no pull requests, no releases, and no Actions
  runs. Wiki, Discussions, and Pages remain disabled.
- Pass: Gitleaks 8.30.1 and the Cadence public-source checker found no secret,
  private-recipient, history-metadata, or client-environment finding. The fresh
  executable clone contains 140 commits and all required policy files.
- Pass: clean dependency installation reproduced Next 16.3.3, Astro 7.2.6,
  esbuild 0.28.2, PostCSS 8.5.26, sharp 0.35.3, and SVGO 4.1.0 without changing
  either manifest or the root lockfile. Full and production-only npm audits
  returned zero findings.
- Pass: all repository checks, lint, typecheck, 1,008 tests with one skipped
  test, the exact Next 16.3.3 Turbopack build, the Astro build, and the Astro
  check passed. Six public canaries had intended placements only. Ten
  server-only canaries were absent. Final placement counts were 20 Next and 23
  marketing artifact files.
- Pass: a clean local Supabase reset applied all 33 migrations through
  `20260825080815_add_occurrence_sync_batch_order_index.sql`. The catalog audit
  covered 18 RLS-enabled public tables and 12 authenticated functions. Local
  RLS smoke passed 92 ownership checks and cleaned three temporary users.
- Pass: hosted migration and catalog reads match local state. The linked
  project has no pending migration. Hosted RLS smoke evidence remains valid
  because no schema or RLS source changed. The bounded final window forbade
  deleting hosted data, so the gate reused that already-passed 92-check smoke
  instead of creating new fixtures.
- Pass: production web deployment `dpl_3KGt9dNUy2bg1UxtMdLWDakqDBSZ` is READY
  at the executable commit. Vercel ran the default Next Turbopack build. All
  audited public and authenticated-route boundaries responded as expected.
- Pass: production marketing deployment `dpl_7gLBemWhZ9WuaUujD2npwu62JUGd`
  is READY at the executable commit. It consumed the committed root workspace,
  lockfile, and overrides, resolved esbuild 0.28.2, and completed the Astro
  build. All 19 audited public endpoints returned HTTP 200.
- Pass: the inline Astro PostCSS boundary keeps marketing independent from the
  web application's Tailwind plugin while preserving one root lockfile and one
  override policy. The canonical aliases and domains remain unchanged.
- Pass: the recovery directory remains mode 700 at
  `/private/tmp/cadence-ticket098-history-rewrite-XTnslg`. Its mode-600 bundle
  and backups remain intact. Detached worktrees and old local objects were not
  pruned.

Release decision: PASS. At this Ticket 098 checkpoint, Ticket 100 still
required separate explicit authorization. Ticket 100 later completed through
its separately authorized publication and verification work.

## Open-source license and disclosure contract (Ticket 099)

Status: complete locally. Safe local policy implementation, monitor assignment,
and recipient-side route verification are complete.

Prepared:

- Added `docs/OPEN_SOURCE_DECISION_PACKET.md` as a public-safe final decision
  record. Root `LICENSE`, `SECURITY.md`, and `README.md` remain the operative
  public terms.
- Inventoried every direct Node and Python dependency, declared license,
  bundled font, imported icon library, tracked image and audio group, generated
  sample bundle, BehaviorLog material, and existing third-party provenance
  signal.
- Distinguished the hosted Terms, Privacy, and Trust pages from source,
  trademark, asset, sample-content, and user-data rights.
- Recorded the owner's MIT selection, dedicated-security-email primary route,
  post-publication GitHub private-reporting secondary route, split copyright
  scope, included-group rights confirmation, binary-asset exclusions, and
  reserved Cadence marks.
- Recorded the repository owner as the security inbox monitor. The owner
  authorized exactly one harmless synthetic route-test email to the approved
  address.
- Kept copyright licensing separate from permission to use Cadence names or
  logos as trademarks. No affirmative trademark-use grant is approved.
- Added the standard root MIT `LICENSE` with
  `Copyright (c) 2026 Identity Scaffolding LLC`.
- Added root `SECURITY.md` with `security@identityscaffolding.com` as the
  primary private route, post-publication GitHub private reporting as the
  secondary route, current-production/latest-source support, requested report
  details, coordinated disclosure, and safe research boundaries.
- Fetched the exact MIT license from the pinned BehaviorLog validator commit
  and preserved it in the narrowly scoped `THIRD_PARTY_NOTICES.md`.
- Updated `README.md`, Operations, Decisions, public architecture, and the
  release record with the split MIT scope, named binary-asset exclusions,
  reserved marks, self-hosting secret responsibilities, and hosted-service and
  user-data boundaries.
- Reviewed the hosted Terms, Privacy, and Trust copy. It remains a separate
  service contract and needs no content change for the selected email and
  GitHub reporting routes.

Operational follow-up:

- The test message landed in the junk folder. Monitor junk and quarantine
  folders or maintain appropriate allowlisting so filtered private reports
  receive review.

Later follow-up:

- Test GitHub private vulnerability reporting separately after Ticket 100
  enables it.

Verification:

- Pass: `npm run agents:check`.
- Pass: `npm run interactions:check` (1 mechanically checked entry; 87 entries
  explicitly require human side-effect review).
- Pass: `npm run resolvers:check`, `npm run lint`, and `npm run typecheck`.
- Pass: permission-enabled `npm run test` (130 files passed, 1 skipped; 1,008
  tests passed, 1 skipped). The first sandboxed run failed only because the
  existing fake Sequenzy server could not bind loopback.
- Pass: `npm run build`.
- Pass: `npm run marketing:build` built five static pages after generating the
  sanitized example bundle. Astro reported zero errors, warnings, or hints.
- Pass: `npm run marketing:check`; Astro reported zero diagnostics and the
  agent-readability check passed.
- Pass: `npm run public-source:check` reviewed 571 tracked and unignored text
  files plus all-ref patch history. It found zero worktree or history
  credential-pattern findings and zero client environment violations.
- Pass: focused policy inspection found the approved holder and email in the
  root files and no placeholder in `LICENSE`, `SECURITY.md`, `README.md`, or
  `THIRD_PARTY_NOTICES.md`.
- Pass: `git diff --check`.
- Pass: the root execution context sent exactly one authorized synthetic
  private-route test. The sender accepted and retained the message with sent
  status. Recipient-side inspection confirmed receipt at the approved mailbox;
  the message landed in the junk folder. No screenshot, sender address,
  provider identifier, message header, message content, vulnerability detail,
  credential, user data, or behavioral content was recorded.

At Ticket 099 completion, Ticket 098 passed and Ticket 100 remained
`not_started` pending separate explicit authorization. The one authorized
synthetic route-test email was Ticket 099's only recipient mutation.
Ticket 099 made no GitHub, deployment, publication, commit, or push mutation.
Ticket 098 later performed the separately authorized private `main` rewrite.

## Public repository publication and GitHub controls (Ticket 100)

Status: complete. Publication, repository controls, and production
account-deletion failure recovery are verified. The canonical repository is public at
`https://github.com/emixd12/habit-tracking-app`. The released implementation
commit verified in production is `c86a6d4a366a6e322a23b6977f9c2d812efdef25`.

GitHub evidence:

- PR #1 introduced pull-request CI and weekly Dependabot configuration. PR #9
  added the public-source boundary check. CI run `32920923372` passed every
  required repository, lint, typecheck, test, Next build, Astro build, and
  Astro check at `56609924d637947234c695905f46c6d6e6eef203`.
- Strict `verify` protection applies to administrators, requires pull requests,
  and blocks force pushes and deletion.
- The dependency graph, Dependabot alerts and security updates, secret
  scanning, push protection, private vulnerability reporting, and CodeQL
  default setup are enabled.
- CodeQL run `32921147161` passed for Actions, JavaScript/TypeScript, and Python.
  One heading-slug alert was dismissed as a false positive with a concrete
  repository-only data-flow rationale. Open secret, dependency, and CodeQL
  alert counts are zero.
- GitHub blocks repository administrators from self-submitting through the
  public private-report form. One harmless low maintainer draft advisory tested
  the equivalent private route and was closed immediately.
- PRs #11 and #12 merged through protected `main`. Exact `main` push CI run 27
  passed. Required conversation resolution is enabled and was read back as
  active before the final merges.

Public and production evidence:

- A fresh unauthenticated HTTPS clone at the release commit passed `npm ci`,
  all repository checks, `npm run public-source:check`, lint, typecheck, 1,008
  tests with one environment-gated skip, the exact Next build, the Astro build,
  and the Astro check. `LICENSE` and `SECURITY.md` were readable.
- The marketing `View on GitHub` link reached the canonical public repository
  in an unauthenticated browser.
- Application deployment `dpl_FzvK2siMz4VwkCQ5hCxSTCcKa1bH` and marketing
  deployment `dpl_DMAQ4o6u1QkqxtGC2WZ9YramCe42` are READY at the release commit.
- A fresh Google OAuth flow using the existing account completed through the
  production callback and returned to the authenticated Timeline. Timeline read
  and one reversible status mutation and notification readiness passed. The
  authenticated Export page rendered all four download contracts. One CSV
  download returned a non-empty attachment with the expected contract. The
  temporary copy was removed immediately without retaining its contents.
- An intentionally wrong account-deletion confirmation kept the production
  Delete account control disabled. This verified only the client gate. It did
  not invoke the deployed Server Action or verify Auth-deletion failure recovery.
- On 2026-08-26, one authorized disposable Google-authenticated account invoked
  the deployed Server Action through the production browser. Deployment
  `dpl_HFhFd4T5Z4YjbVFbzkmGTrXybvEB` returned the documented recoverable error.
  The session stayed authenticated, and the disposable profile, one synthetic
  Behavior, and 31 occurrences remained. The canary variable was then removed.
  Deployment `dpl_7TUcDZSMsonnLnhte8cvwCes5gHD` restored normal behavior from
  the same Git tree. Normal Settings deletion removed the disposable Auth user.
  Auth plus all 18 user-owned tables then reported zero remaining rows.
- Hosted RLS smoke run `e3d21922` passed 92 ownership checks and removed all
  three temporary users.
- Reminder processing checked, claimed, and sent one isolated browser delivery
  to one active owner-controlled subscription. Cleanup removed the complete
  synthetic record graph. Existing reminders were not claimed. No email was
  sent and no real user record was deleted.
- Marketing had no runtime error in the verification window. The application
  logged one non-failing Node `url.parse()` deprecation warning from the
  browser-push dependency during the successful send. A bounded synthetic raw
  HTTP deletion probe returned 500 before application logic because it could
  not invoke Next's encrypted Server Action. It supplied no account-deletion
  failure evidence. All temporary accounts and profiles were removed.

Remaining risks: the security inbox route test reached junk, so the owner must
keep monitoring filtered folders. The browser-push dependency emits the
recorded Node deprecation warning. The repository owner is the incident
rollback owner; returning the repository to private cannot retract public
clones.

The bounded canary variable was the only production environment mutation in
the final check, and it is unset. No domain, secret, billing, plan, installed
GitHub App, or real-user-data setting changed during Ticket 100.

## Marketing example and agent-readability parity (Ticket 092)

Status: complete locally. No deployment or provider mutation occurred.

- The marketing example now uses the production export resolver and ZIP
  service. Cadence's own import preview accepts the generated bundle with zero
  errors and skips and creates one Behavior plus one schedule.
- The marketing gate now compares substantive privacy and data-handling claims
  between HTML and Markdown mirrors. Route docs now match the five implemented
  marketing pages plus the `/cadence` and `/standard` compatibility redirects.
- Pass: marketing build/check, agent, interaction, resolver, lint, typecheck,
  1,026 tests with one environment-gated skip, and diff check.
- The required default Turbopack build reached an environment-only internal
  helper-port `EPERM` on every attempt, including the permission-enabled run.
  The same production build passed with Webpack. No source build error was
  reported.

## Public Trust evidence contract (Ticket 101)

Status: complete locally. No production check, deployment, GitHub Pages, or
provider mutation occurred.

- Added the versioned `cadence.public-trust-evidence` JSON Schema, pure
  validator and normalizer, immutable-link and sanitization rules, fixed
  freshness policy, five statuses, nine required checks, fixtures, tests, and
  the `public-trust:check` command.
- GitHub Pages evidence paths must include the workflow run and both deployment
  IDs. Consumers derive Stale for expired or mismatched Passed results while
  preserving Failed, Stale, Not run, and Unavailable.
- Pass: public Trust fixture check, 15 focused tests, 1,028 full tests with one
  environment-gated skip, agent, interaction, resolver, lint, typecheck, and a
  Webpack production build.
- The exact default Turbopack build has the same environment-only internal
  helper-port `EPERM` recorded for Ticket 092.

## Post-deployment Trust verification (Ticket 102)

Status: complete and deployed. Production workflow run `33044434728` published
a current immutable snapshot and `latest.json` for commit
`32ab2b7c18a3abd0629c328b05ac41fec16fe044`.

- Added the least-privilege split Preview/Production workflow, bounded route
  and integrity registries, provenance, dependency, security-control,
  migration, and RLS collectors, immutable Pages retention/publication, schema
  and detail sanitization, and deterministic failure-path tests.
- Preview retains a private Actions artifact and cannot replace the public
  Production pointer. Production publishes valid Failed evidence before
  failing its gate. Invalid or sensitive evidence publishes nothing.
- Pass: 28 focused tests, 1,040 full tests with one environment-gated skip,
  agent, interaction, resolver, lint, typecheck, production dependency audit,
  marketing check/build, public-source check, and fixture publication
  simulation.
- Application deployment `dpl_6WkH2VkxhgZ2J7yUQx3gcfvwq1fb` and marketing
  deployment `dpl_EdDUq7K6KdzhMnTHTYMkzD7Lz1tS` were Ready from the named
  commit. Provenance, CodeQL, public-artifact integrity, application routes,
  marketing routes, the hosted migration boundary, and the 92-check RLS smoke
  passed. The RLS smoke removed all temporary users.
- The dependency audit reported zero vulnerabilities. Dependabot aggregation
  and secret-scanning aggregation remain explicitly Unavailable because the
  workflow token cannot read those provider aggregates. This matches the
  settled provider-unavailability contract and does not infer a Passed result.
- The exact default Turbopack build remains environment-blocked by the same
  internal helper-port `EPERM`; the Webpack production build passed under
  Ticket 101.

## Evidence-backed public Trust page and machine route (Ticket 103)

Status: complete and deployed. PR #27 merged the implementation, and Ticket
102 now publishes a current production snapshot consumed by both public routes.

- The public `/trust` route validates and renders all nine normalized evidence
  checks while preserving the durable Trust commitments. The same result is
  available from `/api/public/trust-evidence`.
- Marketing HTML, Markdown, `llms.txt`, and `llms-full.txt` link to the
  canonical human and machine routes.
- Pass on PR #27: 25 focused tests, 1,061 full tests, agent, resolver,
  interaction, and design-system checks, lint, typecheck, marketing checks and
  build, Webpack production build, and unauthenticated desktop and 390px QA.
- Follow-up: this consolidation records the real ticket state and advances the
  shared marketing modification date to 2026-08-27.

## Tickets 084 and 086: BehaviorLog import apply integrity

Status: complete and deployed.

- Ticket 084 routes accepted create-only and approved-merge imports through one
  transactional RPC. An accepted-preview fence and transaction advisory lock
  make concurrent retries return the first applied result. Product writes and
  mappings roll back together before a failed ledger result is stored.
- Ticket 086 rejects inconsistent occurrence local dates, cross-Behavior
  schedule references, and duplicate intervention ids. Imported-note identity
  is account-scoped and compares both attachment and body content. A composite
  foreign key prevents schedule slots from linking across Behaviors.
- Pass before concurrent Ticket 074/077 resolver edits: five focused import
  suites, 46 tests; `npm run agents:check`; `npm run interactions:check`;
  `npm run resolvers:check`; `npm run lint` with eight existing fixture
  warnings; `npm run typecheck`; and `git diff --check`. The two isolated
  T084/T086 source-contract suites still pass, five tests.
- Pass through migration application and seed: `npm run supabase -- db reset`.
  Its final Storage health probe failed because local Storage was unavailable.
- Pass: local PostgreSQL concurrency smoke returned the same run from two
  simultaneous applies and stored one applied ledger/result. A forced failure
  after initial product writes left zero product and mapping rows and one
  failed ledger row. Both disposable users were deleted.
- Full `npm run test` reached 1,013 passes and 11 failures. Six failures belong
  to the active Ticket 074/077 portability work; five fake-provider tests could
  not bind localhost in the sandbox. `npm run build` hit the same sandbox port
  restriction. A webpack build compiled, then found active Ticket 074/077 type
  gaps outside Tickets 084 and 086. A later focused rerun also stops at the
  active resolver's missing `limitRunningTimeSessions` function.
- Final integrated verification superseded those concurrent-work failures:
  1,036 tests passed with one environment-gated skip. The production webpack
  build and the focused 19-test migration suite passed.

## BehaviorLog 0.2.0-draft portability chain (Tickets 072-074 and 077)

Status: complete and deployed.

Scope:

- Ticket 072 aligns intervention exports, canonical profiles, the embedded
  schema, and backward-compatible import parsing with BehaviorLog
  `0.2.0-draft`.
- Ticket 073 moves definition history, time sessions, and reminder rules into
  canonical profile files.
- Ticket 074 replays standard definition history and safely mapped time
  sessions through create, approved merge, and restore apply.
- Ticket 077 restores custom ranges, normalized categories, standard reminder
  rules, archive state, and shared schedule parents.

Ticket 072 verification:

- Pass: `npm run behaviorlog:conformance` against the byte-exact upstream
  `0.2.0-draft` validator snapshot.
- Pass: focused export/import compatibility suites, `npm run resolvers:check`,
  targeted lint, `npm run typecheck`, and `git diff --check`.

Ticket 073 verification:

- Pass: canonical definition-history, time-session, and intervention-rule
  profile coverage in 49 focused resolver, conformance, and UI tests.
- Pass: `npm run behaviorlog:conformance`, targeted lint, and
  `npm run typecheck`.
- The Cadence configuration-history extension remains because the upstream
  draft has no equivalent standard profile. Definition and timing raw files
  were removed.

Tickets 074 and 077 implementation:

- Import and restore parse standard definition-event, time-session, and
  intervention-rule files. Preview exposes their actions and warnings.
- Atomic import and restore RPCs replay portable history, preserve ownership,
  enforce one running time session per Occurrence, and store provenance for
  idempotence.
- Restore matches or creates normalized categories. Import and restore rebuild
  custom range slots, reminder settings, and grouped schedule parents.
- Key files: `lib/resolvers/behaviorlog-import.resolver.ts`,
  `lib/resolvers/behaviorlog-restore.resolver.ts`,
  `lib/services/behaviorlog-import-write.service.ts`,
  `lib/services/behaviorlog-restore.service.ts`, and migrations
  `20260827032029` and `20260827032031`.

Final verification:

- Pass: `npm run behaviorlog:conformance`, `npm run agents:check`,
  `npm run interactions:check`, `npm run resolvers:check`, `npm run lint` with
  eight upstream-validator warnings, `npm run typecheck`, and
  `git diff --check`.
- Pass: 1,036 tests with one environment-gated skip. Focused portability tests
  include the exact 07:15-09:40 custom range.
- Pass: a clean local Supabase start applied every migration and seed. Generated
  database types matched the checked-in types. Direct import and restore RPC
  calls compiled and reached their expected trust-boundary validation errors.
- Pass: local RLS smoke verified 92 ownership checks and removed all three
  temporary users. The Vitest schedule-integrity migration suite passed.
- Pass: `npm run build`. The project build script now selects webpack
  explicitly with `next build --webpack`.
- The rollback-only Ticket 060 SQL smoke is stale after Ticket 095 changed the
  atomic Behavior RPC signatures. It fails before exercising these tickets;
  this task did not expand scope to rewrite that historical fixture.
- Pass after consolidation on current `origin/main`: repository, interaction,
  resolver, conformance, lint, typecheck, marketing build/check, 1,082 tests
  with one environment-gated skip, and the Webpack production build. A clean
  local database reset applied every migration and seed. Generated database
  types matched the committed types. The 92-check RLS smoke removed all three
  temporary users. Local and hosted migration histories matched.

Hosted rollout:

- Pushed migrations `20260827025303`, `20260827030343`, `20260827032029`,
  `20260827032031`, corrective migration `20260827035540`, and helper-removal
  migration `20260827041319`. Hosted and local migration histories match.
- The corrective migration fixed SQL references, JSON path casts, configuration
  event columns, and restore preview-variable ambiguity found by database lint.
  The helper-removal migration drops the two unused Ticket 060 repair functions
  without `CASCADE` or data writes. Local and hosted lint report no errors. Both
  retain four unrelated unused-variable warnings in the BehaviorLog import
  function.
- Promoted Vercel deployment `dpl_7Vx5q3THc1joJmJRwV43kmSrcJSN` to production.
  The canonical domain returned 200 for Login, redirected an unauthenticated
  Timeline request to Login, and rejected an unauthenticated reminder request
  with 401. The post-promotion error-log query returned no runtime errors.

Remaining risk: the raw Cadence configuration-history file remains
intentionally because BehaviorLog 0.2 has no standard configuration-history
profile.

## Handoff notes

### Desktop implementation (Tickets 107–122)

Owner authorization: 2026-08-30. Current requirements live in
`docs/DESKTOP_BUILD.md`; the parity baseline lives in `docs/DESKTOP_PARITY.md`.

| Ticket | Status | Current note |
|---|---|---|
| 107: Desktop track activation | complete | Owning docs, 88 existing interaction IDs with platform metadata, 63 planned desktop intents, strict references, and required checks pass. |
| 108: Native boundary proof | complete | SQLite commit/rollback/restart, scheduling/replacement/cancellation, denied permission, fully quit delivery, and real notification activation pass. The owner accepted visible OS-limited coverage. System sleep/wake subsequently passed under Ticket 112; owner deferred macOS 14 runtime testing on September 27. |
| 109: Shared core and design foundations | complete | Portable core, atomic contracts, tokens, fonts, runtime callbacks, final 0.3 regression checks, and web/marketing builds pass. |
| 110: Local persistence and atomic operations | complete | SQLite schema 6, stable seed, atomic outbox/history writes, migration preservation, and both final 0.3 adapter contracts pass. Clean local Supabase reset replayed 47 migrations; 92 RLS checks pass. |
| 111: Desktop tracking parity | complete | Four screens and native tracking/export/import/replay/keyboard workflows pass. Final 0.3 artifacts are verified. The owner confirmed disconnected-network launch and status persistence; SQLite, process-start, and native UI evidence independently confirm saved completion survived relaunch. The synthetic Behavior is archived with history preserved. |
| 112: Native reminder coverage | complete | Product scheduling, coverage readback, cancellation, fully quit delivery, click/focus, and preserved delivery export pass. Precise profile-midnight, DST, and wake/resume tests pass. Actual 2026-08-31 system sleep/wake renewed coverage before GUI inspection. Ticket 111's dependency is complete. |
| 113: Unnotarized Apple Silicon preview and updater acceptance | complete | The approved preview prerelease is public. Downloaded launch, three updater failure paths, valid .1 to .2 installation, separate restart, and data preservation pass. Both versions use schema 6, so shipped-migration testing is not applicable to this release. |
| 114: BehaviorLog 0.3 portability parity | complete | Canonical passive observations, retained configuration identity, exact passive replay, and accepted source schedule fingerprints pass real SQLite/SQL and native export/import acceptance. Hosted rollout remains separate. |
| 115: Apple-trusted macOS distribution acceptance | in progress | Owner authorized all plan steps September 27. Membership confirmed; valid Developer ID identity and provisioning profile installed; notarization credentials accepted. Apple accepted candidate 0.1.1-rc.1 app and DMG notarization; stapling, Gatekeeper, and strict artifact verification pass. Synthetic production Keychain probe passed; installed acceptance remains open. Owner deferred macOS 14 runtime testing. See `docs/plans/2026-09-27-apple-developer-unblocked-work.md`. |
| 116: Desktop account-sync product and architecture contract | complete | `AGENTS.md`, `docs/PRODUCT_SPEC.md`, `docs/DESKTOP_BUILD.md`, `docs/DECISIONS.md`, `docs/FUTURE_UPDATES.md`, `docs/PUBLIC_PRODUCT_ARCHITECTURE.md`, `docs/AGENT_RESOLVERS.md`, and `docs/TICKETS.md` define the optional account boundary, 100,000-row/64-MiB/30-second snapshot ceilings, planner and retry ownership, and security rules. `npm run agents:check`, `npm run interactions:check`, `npm run resolvers:check`, and `git diff --check` passed. No runtime, schema, provider, or hosted changes. |
| 117: Desktop local database controls | complete | Exact Application Support path disclosure, Finder reveal, consistent online backup, protected local-only restore, validation, rollback contracts, and native restart acceptance pass. |
| 118: Desktop Google authentication and account session | complete | Official Tauri deep-link delivery, query-state validation, exact-once Google PKCE exchange, fixed Keychain storage, distinct SQLite metadata, one-account enforcement, restart persistence, replay rejection, and secret scans pass. Installed preview.15 completed the owner Google round trip through the preview-only legacy login-Keychain path. Production Data Protection Keychain acceptance remains under Apple-signed Ticket 115. See `docs/qa/2026-08-31-desktop-authentication.md`. |
| 119: First desktop account-link data choice | complete | The planner preserves same-status hosted branches only during automatic first hydration of an untouched profile; divergent, local-only, cross-copy, and post-baseline branches remain rejected. Installed preview.19 hydrated the complete owner-scoped account snapshot, preserved pre-existing same-status branches, saved one baseline, cleared the pending attempt, and reached Account data is current. |
| 120: Offline-capable two-way desktop synchronization | complete | Final QA A/B matrices, status transition, branched-history rejection, offline/retry behavior, and hosted/RLS contracts passed. The deployed final hardening serializes same-account plans and cross-account entity identities and bounds receipt storage. Preview.15 preserved the branched-history safety gate with real owner data. |
| 121: Sync conflict review and account disconnect | complete | Conflict cue/review, stale rejection, Mac/account decisions, Keep-local, Remove-account-data, Restore, and revoked-session native paths passed. Keep both remains safely withheld. |
| 122: Account-sync migration and release acceptance | complete | Preview.19 supersedes preview.15. Its installed owner-account hydration, immutable publication, remote hash readback, final-valid updater feed, and production marketing link passed. Migration `20260902052213` and expanded hosted account-sync/RLS smoke also passed. The release remains prerelease and not latest. |
| 123: User-defined categories and descriptions | complete | Web/desktop management, descriptions, history-safe deletion, portability, and sync passed automated and interactive acceptance. Native restart passed; web production rollout passed through PR #45. Desktop production distribution remains deferred. |
| 124: Behaviors category filtering and sorting | complete | Shared category filtering/sorting, archived counts, reset, and draft preservation passed automated, responsive browser, and native interactive acceptance. |

Final 0.3 verification supersedes the earlier 0.2 checkpoints. The clean local
reset replayed all 47 migrations through `20260831014424`, with every published
Cadence port on loopback. The final Supabase contract exercised fresh original-
bundle replay, self-export merge, and restore through ordinary authenticated
clients. It created no duplicate domain/history rows. Captured Occurrence
fields remained unchanged; fresh merge may advance concurrency `updated_at`.
Exact cleanup left zero Auth users, public product rows, Storage data, or Vault
secrets. Generated types match. No hosted migration or deployment ran.

The final suite passed 1,336 tests; fourteen SQLite contracts and the SQL
contract passed separately. Forty Rust tests, both TypeScript targets, lint,
web/marketing builds, app/DMG packaging, and repository checks passed. The
registry now retains 64 implemented desktop intents and no planned intents.
Native 0.3 evidence and
artifact hashes are in `docs/qa/2026-08-30-desktop-0.3-acceptance.md`.

The following activation checkpoint is historical. The current table and the
opening ledger supersede its implementation state and test counts.

Activation changes: `AGENTS.md`, `docs/DESKTOP_BUILD.md`,
`docs/PRODUCT_SPEC.md`, `docs/PUBLIC_PRODUCT_ARCHITECTURE.md`,
`docs/DATA_MODEL.md`, `docs/DECISIONS.md`, `docs/FUTURE_UPDATES.md`,
`docs/TICKETS.md`, and `docs/OPERATIONS.md`. The Data Model header scopes
Supabase/RLS rules to web; it does not claim a SQLite schema exists.

The desktop contract replaces the old Full JSON importer, initial-migration
baseline, SQL-plugin-only transaction assumption, optional cloud login, and
blanket last-writer-wins proposal. Product summaries now match existing
BehaviorLog definition-history and time-session replay. No native QA or
release success is claimed by these documentation changes.

Implementation adds `apps/desktop` with a Vite/React operator bench, a narrow
Tauri command boundary, real SQLite transactions, and a thin macOS
UserNotifications adapter. The separate spike identity/database cannot read
web accounts. Native commands validate input and never accept SQL or arbitrary
file paths. No permission request or notification occurs automatically.
The native gate now passes. `packages/core` contains 15 tracking resolvers,
portable types/hash, and shared Behavior/status/note/timing orchestration.
`packages/ui` provides canonical tokens and bundled font CSS. CSS declaration
parity and focused tests pass. Desktop adapters and Timeline UI are in progress;
no production tracking screen is yet claimed as implemented.

The existing interaction registry is now version 1.3. Its release mode rejects
the 63 desktop intents planned at activation, missing references, and developer-bench sources
masquerading as interaction implementations. The design surface catalog records
the operator bench separately from product usage. The design checker no longer
skips missing desktop/mobile source references.

Verification passed with Node 24: `agents:check`, `interactions:check`,
`resolvers:check`, `design-system:check`, lint (eight existing fixture warnings),
typecheck, 1,121 tests with one environment-gated skip, web build,
`marketing:check`, marketing build, desktop frontend build/typecheck, three native
Rust tests, Rust formatting, debug application packaging, and `git diff --check`.
The first sandboxed web-test run could not bind the existing fake-provider
loopback server; the authorized rerun passed. The parity release gate fails as
expected and does not indicate readiness.

Native UI proof passed actual WKWebView rendering, synthetic SQLite commit,
changed-input rollback, and persistence after quitting/reopening. Permission
readback passed authorized and denied states. Denial blocked scheduling while
SQLite remained usable. Stable-ID rescheduling kept one pending request.
Cancellation and fully quit delivery passed OS readback. Native keyboard Tab reached the commit action.
Browser preview passed 390px/1280px containment and console checks. The local
ad hoc build now binds the bundle identity and resources and passes strict
signature verification; this is not Developer ID signing or notarization.
See `docs/qa/2026-08-30-desktop-native-boundary.md` for evidence limits.

Resolved coverage decision: a 128-request, 24-hour probe retained only 100 requests and
reported 28 missing IDs despite zero scheduling errors. Restart preserved the
100 requests. The host's OS log recorded exactly 28 evictions. Four daily
Behaviors need 120 requests for 30 days with one request per Occurrence.
The owner accepted a clearly displayed OS-limited horizon on 2026-08-30.
Thirty days remains the target. Schedule nearest eligible reminders first and
derive coverage from actual OS readback without skipping gaps. Shorter or
unverified coverage must remain visible. No background helper or silent
truncation was introduced. Native activation subsequently
passed before shared extraction began.

The revised coverage probe verified the nearest 100 of 128 requests and showed
the shorter horizon and first unscheduled instant. It uses the pure native
reminder resolver and a bounded operator-only repair; the product scheduler
remains Ticket 112 work. All capacity probes were cancelled.

The user clicked **Cadence native reminder test** from fully quit. The native
callback recorded `notificationActivated` for `cadence-spike.1` at
`2026-08-30T21:05:16Z`. Cleanup and independent readback verified zero pending
and zero delivered notifications.
The Cadence-only notification setting remains enabled. The owner
authorized these changes and similar local verification; do not request that
permission again. Sleep/wake and macOS 14 remain
unverified on this macOS 26.5.2 host. No hosted data changed and no public
release occurred. Preserve all unrelated Ticket 106 edits.

### Existing handoff context

- For the next coding agent: production browser push subscription is now
  verified in Chrome as permission granted with an active FCM subscription, and
  browser-push production delivery has been verified with a safe temporary due
  reminder. Chrome will not show the native notification permission prompt again
  for an already granted or denied origin unless the site permission is reset.
  Production cron execution has been verified through Vercel runtime logs.
- Ticket 029 completed the first public web hardening baseline. Ticket 030 completed
  first-run onboarding, privacy-safe structured runtime monitoring, and the
  `npm run smoke:rls` many-user RLS smoke command. Re-run the smoke command
  before broad public launch and after material RLS/schema changes.
- Ticket 025 is now split into 025A restore preview and 025B restore apply/UI.
  Implement 025A first, verify it fully, then implement 025B. Ticket 025B is
  intentionally more destructive than the current import/create/merge paths.
- Tickets 107–114 and 116–122 are complete. Ticket 115 membership is now available;
  owner-authorized execution is in progress under the September 27 plan. Do not start web offline/PWA,
  broader workspace restructuring, mobile, billing, or AI work without scoped
  authorization.
- Run `npm run agents:check` and `npm run resolvers:check` before standard lint/typecheck/test/build verification.
- Run `npm run design-system:check` after changing reusable UI, the bench route, or design-system manifest/usage/config files.
- Use `docs/SUPABASE_WORKFLOW.md` for Supabase CLI local/hosted management and `docs/SEQUENZY_WORKFLOW.md` for Sequenzy CLI/provider operations.
- Keep v1 small. Web PWA/offline work remains deferred; desktop local writes are required under `docs/DESKTOP_BUILD.md`.
- Preserve the resolver-first architecture: core logic belongs in `lib/resolvers`, database access in `lib/db`, orchestration in `lib/services`, and UI/API routes should not duplicate resolver logic.

Desktop repair rollout continuation (2026-09-08): hosted guard 20260908174627 and
signed updater preview.21 are published. Installed recovery reduced the live
database from 6.21 GB to 6.53 MB, preserving existing records and the recovery
backup. Tickets 129–130 remain in_progress pending Keychain completion, normal
sync convergence, and repeated reconciliation. Ticket 131 remains in_progress.

## Desktop repair acceptance — 2026-09-09

Tickets 129 and 130 are complete. Installed preview.21 converged with the hosted
account after owner Keychain approval. Unchanged sync succeeded; all domain
mutations are acknowledged. Integrity and foreign-key checks passed. Repeated
native reminder reconciliation retained one receipt per operation with zero
measured file growth. The protected backup remains intact. Ticket 131 remains
in progress for signed installed updater acceptance. See
`docs/qa/2026-09-08-desktop-repair-implementation.md`.

Ticket 131 rollout: preview.22 is published and installed; its executable matches
the verified artifact. Restart now waits for renewed owner Keychain access.
Preview.23 artifacts from identical source are uploaded and verified, but public
feed activation was rejected by automatic approval review pending explicit owner
authorization. The feed remains preview.22. Ticket 131 remains in progress.

Ticket 131 remains in progress after installed QA exposed missing native updater
permissions in preview.22/23. The minimal permission correction passes repository
checks and builds. The public feed was restored to repair preview.21; installed
preview.22 remains functional for tracking but requires direct replacement to
repair self-update. Corrected preview.24 verification is in progress.

Preview.24 is now activated and directly installed with owner approval. Strict
codesign and executable hash verification passed. Protected domain/account rows
are unchanged; SQLite integrity and foreign-key checks pass. Startup waits for
renewed owner Keychain approval. Ticket 131 remains in progress for final installed
acceptance; Tickets 129–130 remain complete.

Preview.24 post-Keychain verification passed: Timeline and Settings open, account
data is current, automatic downloads are enabled, and live update checks succeed.
Ticket 131 is implemented and released, but remains in progress until a newer
signed release verifies the corrected download/install lifecycle. No owner action
is currently required to use preview.24.

Calendar release review correction: wrong-account cleanup now has a Google Account connections link and project-wide revocation disclosure. Native source preserves the mismatch result. Preview.34 predates this correction; native acceptance remains open. Hosted rollout remains unapproved.

Final Calendar correction review: `ship` with no findings. Main checks passed with 1,739 tests (29 skipped); isolated web candidate passed with 1,681 tests (26 skipped). Hosted rollout proposal is `/tmp/cadence-calendar-hosted-rollout.md`. Hosted migration/configuration/deployment approval, live grant, and installed native acceptance remain open.

2026-09-17 Calendar rollout: owner approved remaining operational gates. Calendar migration, private Vercel settings, and reviewed web candidate are deployed. Same-account web consent, primary selection, refresh, Timeline rendering, details/focus, and 390px targets pass. Native preview.35 exposed a fetch receiver issue; source fix and tests pass with independent ship review. Preview.36 acceptance is in progress. Tickets 133–137 remain in progress.

2026-09-17 native continuation: preview.36 live reconnect, selection, refresh, disconnect/cache cleanup, details/focus, and source-link acceptance pass. Protected tracking rows remain unchanged. Preview.37 installs the reviewed callback-message correction, restarts with Calendar context, and passes artifact checks. All required affected checks pass with 1,740 tests (29 skipped). Evidence and remaining native/provider acceptance are recorded in `docs/qa/day-progress-release.md`. No further owner approval is requested for already authorized task actions.

Preview.37 offline restart acceptance passed with cached Calendar markers and an explicit stale/last-refreshed label. Wi-Fi was restored and confirmed connected. Short native CPU samples cover visible, hidden, minimized, settled minimized, and unfocused states; the settled minimized repeat measured zero CPU. Remaining gates include live wrong-account/provider-failure cases, native account-switch/synthetic/multi-day cases, and Google public verification.

Final Calendar recovery correction: preview.38 is installed with protected preview.37 rollback and consistent database backup. All 11 artifact checks pass. Required affected checks pass with 1,740 tests (29 skipped), and fresh independent review returns ship. The primary Calendar is restored. Second-account acceptance awaits the owner's Chrome-profile choice because the requested account is absent from Identity Scaffolding.
