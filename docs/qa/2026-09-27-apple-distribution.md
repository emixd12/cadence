# Ticket 115 Apple distribution execution — September 27, 2026

## State

Execution is authorized and in progress. Apple-trusted distribution is not accepted.
The owner authorized all steps in the linked implementation plan, including
credential setup, signing, notarization, installed acceptance, and gated publication.

Source baseline: `9eda5c039bbf1c6e306a40a2a720f8d0cb02c43a` plus this task's uncommitted
release changes. Unrelated working-tree edits remain present and must not enter
a release without review. Installed app: `0.1.1-preview.45`. Host: arm64, macOS
27.0 (`26A428`). Candidate `0.1.1-rc.1` is built and signed but not installed.
Its isolated managed checkout is
`/Users/emi/.codex/worktrees/apple-distribution/habit-tracking-app` at the baseline
above, plus the seven reviewed release/test files and a candidate-only version bump.
It reuses installed dependencies and the native build cache; unchanged core/UI
workspace code was checked before building. Unrelated working-tree changes are excluded.

## Apple setup

- The portal confirms team `HK26VT477G` and active membership.
- The portal had no certificates or registered App IDs before this work.
- Registered **Cadence Desktop**, explicit identifier `app.cadence.desktop`.
- The portal confirms App ID prefix `HK26VT477G`. No optional capability was enabled.
- Certificate Assistant generated the **Cadence Developer ID** key and a public CSR.
- A metadata-only Keychain lookup confirms the named key exists. Private key material was not read.
- The CSR self-signature passes `openssl req -verify`.
- Public CSR: `~/Library/Application Support/Cadence Release/apple/CadenceDeveloperID.certSigningRequest`.
- The enclosing signing folder has mode `0700`. Private key material was not exported or printed.
- The G2 Developer ID Application issuance form has the public CSR selected.
- The owner confirmed issuance. Apple issued certificate `ZB2XL7RCW7`.
- Installed identity: `Developer ID Application: Emiliano Bache Rodriguez (HK26VT477G)`.
- Identity SHA-1: `1867D2E0F177BEBABBAB60913E0E077F007AD5D1`.
- Certificate SHA-256: `340653573c67c2cc5027c81a4411ac80e38da6586c59dd275c5cdfd951e618a0`.
- Certificate validity ends September 17, 2031 at 00:00 UTC (September 16 in the portal's local display).
- Installed Apple's official Developer ID G2 intermediate. The identity then passed `security find-identity -v -p codesigning`; no trust override ran.
- Generated **Cadence Desktop Developer ID**, profile UUID `79fa4d71-4d9c-4c89-945a-15c0970c3e2f`.
- The decoded profile includes the issued certificate, exact App ID, team, and `HK26VT477G.*` Keychain authorization.
- The owner entered the app-specific password through a hidden local Terminal prompt. It is stored in login Keychain service **Cadence Apple notarization**, account **emilianobache@gmail.com**.
- `notarytool history` authenticated successfully. Passwords remain outside source and logs.
- Certificate and profile copies are mode `0600` under the protected signing folder.

## Source changes

Production build environments strip `CADENCE_LEGACY_KEYCHAIN_QA`; previews explicitly
retain it. Artifact verification rejects the preview Keychain marker in production.

Production overlays use the registered App ID/team/private Keychain group from
`apps/desktop/src-tauri/Entitlements.plist`. They embed the profile supplied through
`CADENCE_APPLE_PROVISIONING_PROFILE`; preflight rejects a missing/non-file/relative
path. Preview overlays omit both production entitlements and the embedded profile.
Actual candidate inspection confirms its three signed entitlements exactly match
`Entitlements.plist`. The embedded profile authorizes its App ID/team/access group.
Strict deep code-signature verification passes, and the preview-only marker is absent.
Candidate executable SHA-256:
`b870f84f2ab871d6fbb7d76834c2b772f97de10ee16c4f40b425403dfa24a398`.
Installed authentication remains a separate acceptance gate.

The upgrade regression exercises the real `DesktopAuth` class with synthetic native
and Supabase boundaries. Absent production credentials retain linked SQLite metadata,
baseline, and pending outbox state. Same-account reconnection succeeds; another account
is rejected and loses only its newly issued session. Native installed upgrade evidence
is still required. The existing native adapter maps Keychain read errors to absent
items, so synthetic write/read/delete acceptance must distinguish entitlement failure
from a genuinely missing session before installing a production candidate.

A Developer ID-signed probe compiled the unchanged `native/auth.m` with the same
entitlements and provisioning profile. Two uniquely named synthetic accounts passed
write, update, read in a second process, and deletion in a third process. The probe
never read or modified real session/calendar accounts or SQLite. This proves native
Data Protection Keychain authorization; it does not replace the installed OAuth,
Calendar pending-state, restart, disconnect, or upgrade matrix.

## Verification

- Focused release/authentication tests: 41 passed across four files, repeated successfully in the isolated candidate checkout.
- `agents:check`, `interactions:check`, and `resolvers:check`: passed.
- Lint and TypeScript: passed, including a rerun after the production overlay changes.
- Final full suite outside the sandbox: 2,328 passed, 29 skipped. The first sandboxed
  run hit five localhost-bind denials; the affected seven-test file also passed separately.
- Web build, desktop TypeScript/frontend build, marketing check/build, and design-system check: passed.
- Desktop parity: passed structurally; this does not prove installed acceptance.
- Native Rust tests: 109 passed.
- Real SQLite adapter contracts: 20 passed, one skipped.
- Opted-in Minisign signature checks: six passed.
- Entitlements plist syntax and `git diff --check`: passed.
- Independent read-only review: **ship** for preparatory source, with no findings.
  A fresh checkpoint review also returned **ship** for continued execution after
  credential setup and the compatibility deferral. Neither verdict accepts signed
  distribution or native upgrade behavior.
- Local Supabase contract: attempted, unavailable. The installed CLI wrapper reports
  SIGKILL even outside the sandbox. Docker is available, but no Cadence/Supabase stack
  is running. No hosted substitute or database mutation ran.

## Candidate and protected upgrade preparation

Production `release.mjs check` passes with real credentials. The candidate frontend
and native release build pass. Tauri submitted the signed app to Apple at
2026-09-27 21:21:24 UTC; submission `a2ab84c3-33bf-4815-b0d2-1a90bf05cccb` is
**Accepted**, confirmed by the hourly monitor at 2026-09-27 23:36 UTC. The exact
acceptance time was not returned. Tauri stapled the app, built and signed the DMG,
and generated the updater archive and signature. App staple validation passed.
The release process then exited with status 1 because the DMG has no stapled ticket.
The owner authorized repair of this failure. The existing signed DMG was submitted
once as `2f2e691c-c46c-4c81-acd3-5a14da21971e` at 2026-09-28 00:47:36.728 UTC.
Apple returned **Accepted**. Stapling succeeded. The unchanged strict artifact
verifier passed at 2026-09-28 00:51:30 UTC: app/DMG signatures and staples, Gatekeeper
(`Notarized Developer ID` for both), read-only DMG equality, updater signature, and
exact updater archive equality. The accepted app was not rebuilt or resubmitted.

Final DMG SHA-256: `13a168a041a6251b11b3c06b3c28a47c600d1fff9ed12935568df566d2aed361`.
Updater archive SHA-256: `1bc35379ec85c894f8cdf4a9ddfd66c966696443748c827e5a2942a7e3c85cf4`.
Updater signature SHA-256: `37d625ad34da164f0083830f0b15a0289b3c8544cbc0a9ff0f868e1d4bda7e38`.
The updater archive and signature match their pre-repair hashes. The verification
report remains in the candidate checkout at `apps/desktop/.release/artifact-verification.json`.
Hash-verified artifact copies and the report are retained under the protected acceptance
folder at `verified-artifacts/`, with mode 0600 files and a mode 0700 directory.

The production release helper now explicitly notarizes and staples the DMG before
strict verification. It supports both existing credential routes, captures sensitive
subprocess output, requires Accepted status, and keeps previews outside notarization.
Parent verification: 34 release/authentication tests passed across three files;
focused ESLint, repository/interaction checks, and diff checks passed. Fresh read-only
review returned **ship**, with no findings. The new automated full-build sequence
and live API-key submission remain unverified; this repair reused the existing build
with Apple ID credentials. The monitor remains paused after the repaired terminal outcome.
This acceptance is Developer ID notarization, not Mac App Store review.

A consistent SQLite backup passes integrity and foreign-key checks. Per-table
counts and content fingerprints remain in the private acceptance folder:
`~/Library/Application Support/Cadence Release/apple/acceptance-0.1.1-rc.1/`.
The rollback ZIP was restored and matched every file, mode, directory, and symlink;
its strict signature passed. The folder contains that preview.45 rollback ZIP, SHA-256
`2df2da892e638d2ff94576242053e1b7aef27b557f6d3dde3a928db0c2282125`.
The installed preview still runs. No data or account transition has occurred.

## Outstanding acceptance

Test the quarantined download, installed authentication, reminders, and real preview upgrade.
The existing acceptance script requires a schema increase; inspect actual before/after
schemas before using it for this signing-only transition. Do not invent a migration.

The owner deferred macOS 14 runtime acceptance. It no longer blocks Ticket 115;
the compiled minimum remains unchanged and macOS 14 support remains unverified.
Ticket 165's Core Location signing hypothesis remains untested. No new app installation,
public asset upload, feed change, or marketing claim occurred.

Web behavior and future mobile are unaffected. Desktop implementation remains Ticket
115. Marketing retains its preview disclosure until all publication gates pass.

## Post-notarization implementation checkpoint

The owner requested parallel execution of authentication, Calendar, location,
reminders, and distribution acceptance. The owner identified an existing test
identity; the September 17 Calendar record confirms that identity and its prior
protected desktop switch/restore workflow. Only one macOS user exists. Reusing
the test identity does not establish fresh macOS-user acceptance.

Three independent workstreams implemented production Calendar pending-state
validation, explicit same-schema data-preservation acceptance, and safe native
probe cleanup/capacity guards. Parent verification passed 72 focused tests and
2,373 full-suite tests (29 skipped), lint, TypeScript, web build, desktop type/build
and structural parity, repository/interaction/resolver checks, design-system
checks, and marketing check/build. Native Rust tests passed (109); real SQLite
contracts passed (20, one skipped). Fresh read-only review returned **ship** with
no findings. The existing isolated checkout now builds `0.1.1-rc.2` with only
reviewed changes; rc.1 artifacts remain retained.
The prior DMG CLI regression needed an explicit environment type annotation;
TypeScript passed after that correction.

Chrome downloaded the rc.1 DMG through an isolated loopback server on port 4324.
Its SHA-256 matches the retained artifact and `com.apple.quarantine` remains present.
This proves browser download integrity, not launch or public HTTPS delivery.
The current source corrections require a new reviewed candidate before final
installed acceptance. The installed preview and primary account remain unchanged
at this checkpoint.

## rc.2 notarization and installed checkpoint

Apple accepted rc.2 app submission `f74b3066-b750-4548-997c-0b40d37816aa`
and DMG submission `b8478e76-e680-4cda-ad27-c421c738a4d8`. The complete
automated build exited zero. Strict verification passed at
2026-09-28T01:34:16.383Z, including both staples, Gatekeeper, exact DMG/archive
contents, hardened runtime, entitlements/profile, and updater signature.

- DMG SHA-256: `dcf22046c08d38e9abc37a99e36f5fde9c0e5d5b35ed4cbf3e082310435d125a`.
- Archive SHA-256: `7e5588cd2a7de197495df7719f5623a18f1238c59d7b2991233ad3a4825e2498`.
- Signature SHA-256: `4dc92d6576586a3dd98ac49b40a94dd974f38c2ad53ef2d4b68ac0f8aca3f7cf`.

Chrome downloaded the exact DMG from the isolated port-4324 server. Finder
copied the app into Applications with quarantine retained. Normal first launch
showed Apple's Internet-download confirmation and its no-malicious-software
assessment. Selecting Open launched the empty local Timeline and Settings.
Earlier automation timeouts occurred while that confirmation remained behind
a timeout notice; sampling showed the loader had not entered app code. There
was no Gatekeeper bypass or quarantine removal. Public HTTPS delivery remains
unverified. Settings reports rc.2, notification permission Allowed, zero
reminders retained/eligible, and a verified 30-day empty horizon. This does
not prove notification delivery.

Before installation, the stopped primary database produced a consistent schema-17
backup with integrity/foreign-key checks passing. The complete primary working
directory and preview.45 app remain preserved under the protected rc.2 acceptance
folder. A fresh live directory isolates the dedicated test identity. Primary
restoration remains required after this test. The test Google identity exists,
but Chrome requests its password; the owner received a credential-entry handoff.
No primary-account sync or credential changes occurred.

Installed inspection found an actual release-configuration gap: rc.2 omitted
`VITE_CALENDAR_BROKER_ORIGIN`, so Calendar and Daily Brief report unavailable.
Production preflight did not reject this omission. The canonical broker origin
also needs the exact CSP allowlist entry. The next candidate must include
reviewed validation and configuration corrections before feature acceptance.
rc.2 remains retained as notarization/install evidence, not a public release.

## Restored primary app and rc.3 preparation

The parent cancelled the pending native test sign-in and quit rc.2 normally
before restoring the complete original working directory and preview.45 app.
The original profile identity is unchanged; restored SQLite integrity is `ok`,
with zero foreign-key errors. Settings confirms preview.45 and the original
Google account signed in. Reminder reconciliation retained 100 of 433 eligible
requests; its OS-limited horizon remains disclosed. The rc.2 test directory and
app are retained under the protected acceptance folder. No primary credentials
were moved between legacy and production Keychain services. The test Google
password handoff remains open; native account acceptance is incomplete.

The endpoint fix requires the public Calendar/Daily Brief/Travel origin for
production builds, checks the exact reviewed native CSP entry, and refuses
packaging when fresh frontend output omits it. Preview/local omission remains
allowed. Reports explicitly limit configuration evidence to the fresh frontend.
Parent verification passed 37 release tests, the updated exact-CSP regression,
root TypeScript, governance checks, and the full suite: 2,398 passed, 29 skipped.
Fresh independent endpoint review returned `ship`, with no findings. The isolated
checkout now builds rc.3 with `https://app.cadence-me.com`; no public publication
or feed change has occurred. rc.2 artifacts remain retained.

## rc.3 completed artifact acceptance

Apple accepted rc.3 app `974b47a7-ae96-4e12-bcb4-8f5d14228e30` and DMG
`c29f1d64-3a89-440d-85cc-1e093fa08c47`. The build exited zero. The strict
report is dated 2026-09-28T01:56:46.626Z and verifies signatures, both staples,
Gatekeeper, exact DMG and updater-archive contents, and the updater signature.
It separately records the three public configuration names present in fresh
frontend output before packaging. It does not establish installed broker behavior.

- DMG SHA-256: `11825f9d9b94ee9e9a9c246730eac40b2e6b6fb81ce016dd8cf8ea7cc4c2e319`.
- Archive SHA-256: `0db4d189d8135b9af8653e9ba09c6e257f2765966286a41e3281dda383ebacb9`.
- Signature SHA-256: `a419f54ae426cca07c1700f4cd425238d84e7fa47ab5f96b67bfe5b6432570d0`.

Hash-verified immutable copies, the report, and sanitized Apple status metadata
are retained under the protected `acceptance-0.1.1-rc.3` folder. rc.3 is not
installed or published. The current installed preview.45 reports account data
current. Restored native coverage retains 100 of 433 eligible reminders through
October 4, 2026 at 21:50 EDT, with the shorter horizon disclosed. The old test
DMG is ejected and the loopback download server stopped.

Remaining: owner sign-in to the existing dedicated test identity; rc.3 installed
authentication/Calendar/Brief and same-schema preview transition; quit/reminder
activation, offline and sleep/wake acceptance; navigation acceptance; controlled
updater and public distribution gates. Location timeout remains unresolved on
this host even with Developer ID; no speculative native fix was applied.
The next session should reuse retained rc.3, not rebuild or resubmit it without
a demonstrated source/configuration change.


## Local Supabase shared-adapter checkpoint

The full authenticated local Supabase contract passed on the retained schema
at 2026-09-28T01:59:33.843Z. Vitest passed one test with the full four-account
branch enabled. The contract exercises shared transactions, cross-account RLS,
rich import projection, Keep restore, BehaviorLog 0.3 lineage, and Categories.
The capacity-only branch was disabled.

The reviewed project-only Docker proxy restored the local prerequisite.
Its 20 fake-daemon tests passed; fresh independent review returned `ship`
with no findings. The operation used Supabase CLI 2.105.0 through the installed
binary override and an unlinked temporary workdir. No hosted API call, global
Docker change, network change, or credential output occurred.

Seven owned services started on the existing `cadence-local` bridge. Docker
configured all three published bindings to `127.0.0.1`; the runtime watchdog
checked them throughout the operation. The six configured health checks passed.
PostgREST has no configured health check. The proxy socket had mode `0600`.

Aggregate inspection found two existing accounts and 1,100 rows across 29
checked tables. The retained data is unclassified, so clean reset/replay remains
blocked. No reset or migration ran. The retained schema records 74 migrations,
through `20260922200000`; git contains 76. These newer migrations remain unapplied:

- `20260926150000_daily_brief_bounded_recovery.sql`.
- `20260926170000_daily_brief_analysis_sources.sql`.

The contract created unique synthetic accounts and deleted only their recorded
IDs. Every checked table count matched its baseline after cleanup. This verifies
synthetic cleanup and aggregate preservation; it does not establish clean replay
or acceptance of the two newer Daily Brief migrations. No identities or row
contents were emitted.

All seven owned containers stopped after the contract. The database and Storage
named volumes remain preserved. The proxy stopped. A separate Docker metadata
check confirmed the stopped containers and both retained volumes. Sanitized
operation receipt: `/private/tmp/cadence-docker-contract-ZYCC6R/receipt.json`.

## Codex browser sign-in retry

The owner confirmed the existing test Google account in Codex's in-app browser.
Use that browser for subsequent test-account authentication, not Chrome's separate session.
The retained verified rc.3 updater archive installed and launched with an isolated
working directory. Native Settings confirmed `0.1.1-rc.3`. This was an archive
installation; it adds no browser-download or quarantine acceptance evidence.

Cadence's system-browser launch opened Chrome. Moving its already-redirected
Google account chooser to Codex displayed the correct test account, but Google
returned HTTP 400 after selection. No authentication success occurred. The attempt
was canceled through Cadence. Future retries need the original authorization URL
before Google's browser-specific redirect, rather than its transferred chooser.

The unsigned-in Calendar/Brief unavailable labels do not establish missing build
configuration: `product.tsx` supplies their client only when the account is linked.
Runtime endpoint acceptance remains unverified until authentication succeeds.

The original primary working directory and preview.45 app were restored intact.
Native Settings confirmed the primary account, current account data, and refreshed
reminder coverage. The existing OS-limited coverage remains disclosed. All three
live SQLite databases passed integrity checks and had zero foreign-key errors.
The QA app and data remain preserved in the rc.3 `installed-retry` directory.
No public release, updater feed, or hosted account data changed during this retry.

## rc.3 authentication and Calendar runtime checkpoint

Reused the retained, strictly verified rc.3 app and isolated QA directory.
A fresh consistent primary SQLite backup and full app/data rollback were retained
under `acceptance-0.1.1-rc.3/iab-original-link-retry` before installation.

Native Settings showed `Signed in as cadence.testing.is@gmail.com` and
`Account data is current`. The same state survived a normal quit and relaunch.
This establishes installed production sign-in and cross-process session persistence.
It does not establish token-expiry refresh, offline writes, or primary upgrade preservation.

The precise browser completion path was not observed. Native authentication
completed while the agent investigated the browser handoff. Automatic approval
review rejected manual reconstruction of Google's authorization URL; no acceptance
claim depends on that rejected action, and its approval question became unnecessary.

The production Calendar broker loaded the test account's calendar list. Selecting
only `Cadence demonstration`, saving preferences, and refreshing succeeded.
Cadence reported `No Calendar events in this range. Calendar current.` The Calendar
cache contained one complete snapshot. The empty current range does not verify
rendering of a timed event. Daily Brief controls also became available after login;
Daily Brief remained disabled and no model request was triggered.

Both QA SQLite databases passed integrity checks with zero foreign-key errors.
The test account link and sync baseline existed. Calendar callback restart,
replay/expiry runtime, token refresh, and other installed gates remain unverified.

Cleanup passed: Calendar disconnection completed, followed by account disconnection
with Keep a local copy. A further quit/relaunch showed Sign in with Google again.
The QA database had zero account-link metadata rows afterward. QA files remain
retained; hosted tracking data was not deleted. The original preview.45 app and
entire primary directory were restored. Native Settings confirmed the primary
account and preview.45. All three restored SQLite databases passed integrity checks
with zero foreign-key errors. No source/build/publication change ran in this checkpoint.
Primary account synchronization reached current. Reminder coverage was refreshed;
the pre-existing OS-limited horizon remains explicitly disclosed. The protected
restoration manifest now records `primary restored and verified`. Documentation
verification: `git diff --check` passed. No code tests were rerun for this UI-only
acceptance checkpoint.

## September 28 release-check continuation

The retained rc.3 app launched against a complete copy of the current primary
working directory. Original preview.45 and its full primary directory remained
protected under `acceptance-0.1.1-rc.3/remaining-release-checks`.
Before and after snapshots use mode 0600 and self-contained DELETE journals.
The snapshot conversion changed only the snapshot journal mode, not the live DB.

Native Settings retained the account link and offered Reconnect account. No
primary login, import, or hosted sync ran in the copied working directory.
The strict comparison initially rejected two replaced mutation-outbox receipts.
Source inspection confirmed native launch reconciliation intentionally replaces
completed `commitNativeReminderPlan` and `recordNativeReminderCoverage` receipts.
The checker now recognizes only their canonical hash/revision payloads with
matching nonempty creation/completion timestamps. Pending, malformed, domain,
and unknown receipts remain fully protected. Reports count each excluded receipt.

Parent verification passed the updated checker against both protected snapshots:
30 tables, 6,326 rows before and after, schema 17, unchanged stable profile and
retained content, integrity OK, zero foreign-key errors, and zero scoped secret
findings. Each snapshot excluded exactly one completed receipt for each of the
two documented operations. This proves copied-primary launch preservation, not
real updater installation, primary reconnection, or offline synchronization.
Evidence: `remaining-release-checks/same-schema-acceptance.json` (protected).

A separate signed-out local QA copy scheduled `Release QA — quit notification`
for September 28 at 00:08 America/New_York. macOS permission was Allowed. Native
readback verified the nearest two requests, including the test reminder, with
limited coverage disclosed. An unsandboxed process check confirmed Cadence was
closed at 04:06:55 UTC. Notification Center is inaccessible through this host's
computer-use tool; the owner was asked to click the notification. Activation
is not yet verified.

Cadence remained closed after the due time. A manual launch at 04:11:33 UTC read
the due request back from macOS as delivered. This proves closed-app delivery;
the manual launch does not prove notification activation or correct-Occurrence
navigation. The owner did not report a click. The synthetic Behavior was archived
afterward. Settings then verified zero eligible and zero retained QA reminders.

The signed rc.3 location request still reported not yet allowed and timed out.
A narrowly filtered native log recorded `unavailable reason timeout`, then
`prompt reason none`, at 00:12:18 local time. No coordinates were captured or
permission settings changed. Source review did not establish an app defect.
An isolated macOS user or second Mac is still needed to distinguish host permission
state from application behavior. The Google test identity is not macOS isolation.

The public updater feed still advertises preview.24, older than preview.45 and rc.3.
No real update could be offered. No feed, public asset, or endpoint override changed.
A reviewed newer feed target remains necessary for actual installation/restart QA.
A public test location on the QA Behavior did not expose a navigation action in
local mode. No external navigation acceptance is claimed.

Verification passed: 46 focused release-check tests; agents, interactions, resolvers,
lint, TypeScript, JavaScript syntax, build, and diff checks. The full suite returned
2,427 passes, 29 skips, and nine sandbox socket failures. The two affected files
passed all 27 tests when rerun with socket access. Fresh read-only review
`receipt_final_review` returned ship with no findings for the receipt exception.
Requested reviewer configuration was gpt-6-sol/high; actual runtime configuration
and token usage were not exposed. No packaged application code changed, so the
retained rc.3 artifact remains the tested candidate.

Restoration passed. The complete original primary directory and preview.45 app
were renamed back intact. Native Settings showed the primary account current.
All three live SQLite databases passed integrity checks with zero foreign-key
errors. Refreshed OS readback retained 100 of 434 eligible reminders, verified
through October 4 at 22:30 America/New_York. The existing shorter horizon remains
disclosed. The manifest records `primary restored and verified`; QA app/data and
protected snapshots remain retained. No public release was changed.

## Tickets 178–181 execution preparation — September 28

The owner authorized all four remaining release tickets and Ticket 165's remaining
checks. Release tickets retain numbers 178–181; concurrent Daily Brief follow-ups
now use 182–185. No ticket is closed by this checkpoint.

### Clean current-schema acceptance (181)

Created the isolated local project `cadence-release-20260928` from the current
76 migration files, through `20260926170000_daily_brief_analysis_sources.sql`.
The temporary proxy differs from the reviewed proxy only in its exact project
identity. Its 20 fake-daemon policy tests pass. The existing project, stopped
containers, and volumes were preserved. No hosted link or provider call was used.

Both fresh start and `supabase db reset --local` succeeded. All seven service
containers had loopback-only bindings before and after reset. The migration ledger
exactly matched the copied manifest. The real authenticated BehaviorDataStore
contract passed. The separate RLS smoke initially failed because its fixtures
omitted the location-aware configuration contract. Seven fixture fields now match
the existing travel migration; no schema or production behavior changed. The real
smoke then passed 92 ownership checks and removed its three temporary users.

Final aggregate checks found zero Auth users/sessions, Storage objects/buckets,
Vault secrets, and user-owned public rows. The one migration-seeded global route
quota row remained. All temporary containers and the proxy were stopped. Named
volumes were preserved. Sanitized evidence is retained at
`/private/tmp/cadence-clean-schema-20260928/acceptance.json`; migration-manifest
SHA-256: `94dd829d8d83ff83cd53485360c7593ecbddb557034923ce7355936c3ea35722`.

### Controlled updater preparation (180)

Added only the exact separate QA endpoint to preview validation:
`https://github.com/emixd12/habit-tracking-app/releases/download/desktop-updater-qa-20260928/latest.json`.
HTTP, query suffix, another owner, and another date remain rejected. No runtime
override, signature bypass, version bypass, or public-feed change was added.

Built `0.1.1-preview.46` from the reviewed `apple-distribution` checkout with the
existing persistent updater key and legacy Keychain mode. Apple credentials were
absent. The source app contains the exact QA endpoint. The agent's full preview
artifact verification and the parent's independent rerun both passed: strict ad hoc
signature, hardened runtime, arm64, DMG equality, updater signature and archive
equality. This QA source is not a notarized release or a compatibility claim.

Source artifacts are retained at
`/Users/emi/.codex/worktrees/apple-distribution/habit-tracking-app/apps/desktop/.release/preview/0.1.1-preview.46`.

| Source artifact | SHA-256 |
|---|---|
| Executable | `51e6a6e1bb3f619b03e3b6c30e9616d1ec6976071f28f197d88c6a3c7cadf6b1` |
| Archive | `b0830d0782409fef203cb5f603ba8216fa763202d5bb615990e7341ea2f5ffe5` |
| Signature | `5768a94bc3b56ce522c1ea800684ca9c99da8a56bf2e757c30372cecc46f0e54` |
| DMG | `055f6b40095adddc8e77a6b268cf65dd38c61c3b86e7645d72375225729178d4` |

The unchanged, retained notarized rc.3 remains the intended target. Prepared
four feed stages and five asset files in ignored `.local/release-updater-qa-20260928`:
wrong signature, tampered archive, unavailable download, then the valid target.
Every stage advertises the actual rc.3 version. Parent crypto verification accepted
the unchanged target and rejected both negative fixtures. These checks are not live
updater acceptance. Normal source quit/relaunch is required between same-version
stages because the app retains its candidate. Interrupted-download recovery stays open.

GitHub read-only checks confirmed repository release access and that the proposed
QA tag is unused. No release, tag, upload, feed switch, or installation ran. The
prepared request uses a separate prerelease and `make_latest: false`. Live updater
execution still follows Ticket 178's account-transition evidence.

### Calendar fixture and owner-dependent checks (178, 179, 165)

Codex's in-app browser confirmed `cadence.testing.is@gmail.com`. Created one event
in `Cadence demonstration`: `Cadence release QA — timed Maps event`, September 28,
11:00–11:30 America/New_York, location `Central Park, New York, NY`. No guests,
conferencing, or notifications were added. Browser readback confirmed the saved
title, time, calendar, and location. Screenshot:
`/private/tmp/cadence-release-calendar-fixture.png`. Retain this fixture for the
pending installed rendering and Maps handoff checks; do not count browser rendering
as installed acceptance.

Native callback testing awaits the owner's choice between Chrome (the system
default Cadence opens) and an owner-operated handoff to Codex. Notification clicking
and actual sleep/wake require owner coordination on this host. A second Mac or
isolated macOS user remains necessary for the unresolved location condition. No
TCC reset, system permission change, native sign-in, or primary app/data replacement
ran in this checkpoint. The original daily-use preview.45 remains installed.

### Verification and review limits

Governance, interactions, resolvers, desktop parity, design-system, lint, web and
desktop TypeScript, web build, marketing checks/build, 109 native tests, six real
crypto tests, and 20 SQLite adapter/portability tests pass. One capacity contract
remains opt-in. Parent focused release/RLS tests passed 48 tests. The initial full
suite returned 2,433 passes, 29 skips and 23 failures from socket restrictions and
timeouts under concurrent builds. Scoped reruns passed the affected files; the final
46 subprocess-based release-acceptance tests used one worker and a 30-second timeout.
No timeout or assertion was changed in committed test code. A web build first met
another build's lock, then passed after that process completed.

The updater agent completed its bounded implementation/build task. Requested model
and effort: gpt-6-sol/high; actual runtime and token usage were not exposed. Two
fresh-review dispatch attempts failed at the native agent thread limit. Parent
inspected the complete incremental changes and reran checks; no new independent
review or final publication acceptance is claimed.

### Owner-assisted lifecycle checks — September 28 afternoon

The owner selected Chrome, confirmed test-account sign-in, and made a second Mac
available. The daily-use preview.45 app and entire working directory are protected
under `acceptance-0.1.1-rc.3/owner-assisted-lifecycle`; its restore manifest names
every path. The retained verified rc.3 app runs against a copy of signed-out QA
data. No primary account data is in that isolated working directory.

The new synthetic Behavior `Release QA — click this reminder` is scheduled at
15:00 America/New_York. Its Occurrence is
`4b6c10ba-5d7a-4280-92eb-7e0931d5c202`; OS request
`cadence.local.4b6c10ba-5d7a-4280-92eb-7e0931d5c202` has fire time
`2026-09-28T19:00:00Z`. Persisted OS readback verified it scheduled at
18:56:46Z. Cadence was fully quit, confirmed by process absence at 18:57:35Z.
The owner was asked to click at 15:00 without manually launching the app. An
early no-notification reply arrived at 18:58:32Z, before the scheduled fire time;
this does not establish delivery failure. Activation remains pending observation.

Fresh read-only `release_preparation_review` returned `ship` with no findings for
the exact controlled-feed allowlist and seven RLS fixture corrections. It independently
checked Node 24 boundary behavior and syntax. Live updater acceptance remains open.

macOS `usernoted` confirms the exact synthetic request delivered to alert, lock
screen and Notification Center at `2026-09-28T19:00:00.234Z`, with banner
presentation requested. Narrow evidence is saved in
`/private/tmp/cadence-notification-20260928-delivery.log`. No Cadence process
existed at 19:02:48Z. The owner was directed to Notification Center; the operator
has not manually launched the app since the confirmed quit. Click acceptance
remains pending. The installed rc.3 executable matches its retained copy, SHA-256
`89171f8fe538714d1de72da2855678aaa4f990a644ea8eff0becab44094ec8c2`.

**Notification activation passed.** The owner found the reminder in Notification
Center and clicked it. No operator launch occurred. PID 29350 started at
15:04:33 EDT; the app showed “Opened reminder for Release QA — click this reminder
on 2026-09-28” and expanded the matching 15:00 Occurrence. The persisted native
request now reads `delivered`. Screenshot:
`/private/tmp/cadence-notification-activation-20260928.png`. The owner did not
see the initial banner; Notification Center delivery and activation are proven.

For the next actual sleep/wake check, Cadence remains running in the background.
The pre-sleep receipt at 19:05:53Z records PID 29350, start 15:04:33 EDT, native
coverage verified at 19:04:45Z, revision 83, seven retained of 30 eligible.
Evidence: `/private/tmp/cadence-wake-before-20260928.json`. The owner was asked
to sleep, wake, unlock and return to Codex without focusing Cadence.

**Actual sleep/wake passed.** Power logs record Software Sleep at 15:09:09 EDT,
maintenance sleep at 15:09:22, and user HID wake at 15:11:11. Before any operator
focus or Refresh, SQLite showed native coverage verified at 19:11:20Z, revision
85, seven retained of 30 eligible. PID 29350 and its 15:04:33 start time remained
unchanged. `/private/tmp/cadence-wake-after-20260928.json` records these facts.
The owner subsequently confirmed awake. Settings readback after this checkpoint
showed the same counts and truthful limited coverage through October 5 at 15:00.

**Permission revocation passed.** The operator disabled only Cadence notifications
in System Settings, refreshed the isolated app, and observed Denied plus
“Reminder coverage is not verified.” Tracking controls remained available. The
operator restored the original notification permission immediately. OS readback
returned Allowed and truthful limited coverage, seven retained of 30 eligible.
Other notification settings were preserved. Global display-sharing notification
suppression is enabled; this may explain the unseen temporary banner, but that
cause was not independently proven.

**Cancelled account callback passed in Chrome.** The operator started Google
login, cancelled it in Cadence, then selected the signed-in dedicated test Google
identity in the original browser flow. Cadence rejected the actual late callback
with “This sign-in callback was already used or cancelled.” No linked account
was created. The normal native handoff opened Chrome; no OAuth URL reconstruction
or cross-browser transfer was used.

The fresh valid Chrome login authenticated the dedicated test account at
19:15:27Z. Window automation then timed out. A native stack sample showed an
idle event loop, SQLite integrity passed, and account metadata existed; a product
hang is not established. A normal Cmd-Q succeeded and process absence was
verified. Relaunch restored window automation and retained the authenticated
account plus the explicit first-link choice. The operator selected **Ignore local
data and use account data**. Cadence created its normal protected backup,
connected the test account, and reported current synchronization. The synthetic
notification data was not uploaded. Native OS readback then confirmed zero
retained and zero eligible reminders, completing QA request cleanup. Primary
app/data restoration remains due before ending isolated acceptance.


**Calendar interrupted authorization passed on rc.3.** The operator quit and
relaunched Cadence during a pending Chrome Calendar flow, then cancelled in Google.
Calendar remained disconnected. A Developer ID signed, command-line-only probe
queried production Keychain item attributes, never secret values. It confirmed
`pending-calendar-state` absent after cancellation. In a fresh flow the item was
present before quit and after relaunch. Completing the existing read-only consent
connected Calendar and removed the pending item. Account session presence remained
intact. The probe is retained under
`/private/tmp/cadence-keychain-presence-20260928`; it was not registered as an app.
Explicit callback replay and expiry remain unverified.

**Timed Calendar rendering and Google Maps search handoff passed.** The operator
selected only Cadence demonstration and refreshed Calendar. The signed app showed
`Cadence release QA — timed Maps event`, 11:00–11:30 America/New_York, duration
30 minutes, and Central Park, New York, NY. Screenshot:
`/private/tmp/cadence-calendar-render-20260928.png`. Its visible **Search in Google
Maps** action opened Chrome at the Central Park place page. Screenshot:
`/private/tmp/cadence-maps-search-20260928.png`. This proves the search destination;
a search action has no transport mode. Walking preference alone correctly did not
turn the location-only search into directions. No device position or private
location was sent; proactive routing remained disabled.


**Wrong-account reconnection passed on a cloned primary directory.** After normal
test-account disconnection, the operator preserved the isolated QA directory and
cloned the protected complete primary directory with APFS copy-on-write. Original
preview.45 and its complete data remain protected. Signed rc.3 retained linked
tracking data and offered Reconnect account, with no first-link/import choice.
The operator used normal Chrome OAuth with the dedicated test identity. Cadence
rejected it: “Disconnect the current account before signing in with a different
account.” The existing same-schema validator passed all 30 tables, schema 17,
identity/content/history/baseline/cursor preservation, integrity and zero JWT/key
pattern findings. Receipt: `/private/tmp/cadence-wrong-account-preservation-20260928.json`.
Only a synthetic secret canary was supplied; no credential-value extraction was
used. Private snapshots were checkpointed to self-contained DELETE journal mode
after read-only SQLite CLI access failed on their initial WAL representation.
The live database and protected original retained their original journal mode.


**Same-account reconnection and restart persistence passed.** Normal Chrome OAuth
using the original identity reconnected the copied working directory. No import
or first-link choice appeared. Account synchronization reached current and stayed
current after a verified quit/relaunch. Independent read-only comparison found
unchanged profile/account identity, Notes, timers, Behaviors and existing histories.
Six changed Occurrences match six appended explicit user marks, recorded after
the prior sync and before reconnection; all match the new hosted baseline. Five
reminder-delivery changes also match that baseline. Both baseline fingerprints
validate, and cursor changes match synchronization completion. Outbox differences
replace only two canonical completed native reminder receipts. No defect was found.
Receipt: `/private/tmp/cadence-reconnect-difference-review-20260928.json`. The
unmodified strict validator correctly rejects the changed baseline after a real
sync; the independent classified comparison supplies this additional evidence.
Baseline pending domain writes were zero, so pending-write acceptance remains open.

**Controlled updater execution started.** The separate prerelease
`desktop-updater-qa-20260928` now contains only the five prepared assets. GitHub
asset digests match the retained signed target, signature, labeled corrupt fixture,
checksums and provenance. No `latest.json` was uploaded yet; the public
`desktop-preview` feed remains unchanged. The verified preview.46 source replaced
only the copied test installation; original preview.45/data and signed rc.3 remain
protected. Automatic downloads were disabled through Settings before replacement
and must be restored to their original enabled setting during cleanup.

The preview.46 process runs as `cadence-desktop-spike`, not `Cadence`; future
process-absence checks must match the exact installed executable path. Native
window access timed out. A stack sample at
`/private/tmp/cadence-updater-source-launch.sample.txt` shows the main thread
waiting in `SecItemCopyMatching` for legacy Keychain access. The owner was asked
to handle any local Keychain prompt without sharing the password. No bypass,
Keychain ACL change or credential extraction occurred. Live updater discovery,
installation and failure cases remain unverified.


**Primary restoration passed; Ticket 179 complete.** With the Keychain response
still pending, the operator sent SIGTERM only to the identified waiting QA source.
No updater feed, download or installation had begun. The complete original primary
directory (including its recovery backup) and original preview.45 app returned to
their live paths. The tested copy, isolated QA data, signed rc.3 and preview.46 source
remain retained. Original SQLite integrity passed with zero foreign-key errors.
Normal launch showed the original account current and preview.45. Automatic
downloads returned to their original enabled setting. Explicit OS reminder readback
confirmed Allowed, 96 retained of 433 eligible, truthful limited coverage through
October 4 at 23:50 America/New_York. The restore manifest records this verified
terminal state. Completed OAuth and Maps test tabs were closed.

Ticket 179 now has activation, real sleep/wake, revocation/recovery, synthetic
request cleanup, and primary restoration evidence. Ticket 178 retains offline
write/reconnect, actual token renewal/revoked-session recovery, and explicit callback
replay/expiry cases. Ticket 180 is blocked on an owner-operated legacy Keychain
prompt when the QA source is next launched. No password is needed while the daily-use
app is restored. Ticket 181 remains gated; final publication did not occur.
Documentation governance (`npm run agents:check`) passed during this checkpoint.
No production code or immutable release artifact changed in these owner-assisted checks.


### September 29 — updater and second-Mac acceptance resumed

The owner reports allowing the local Keychain prompt. Retained preview.46 now
opens and authenticates normally. Today's complete primary directory and preview.45
app are protected under `acceptance-0.1.1-rc.3/updater-20260929`; a fresh clone is
the live test directory. Automatic downloads were disabled through Settings.
Restoration remains mandatory before ending this session.

The owner supplied second-Mac hardware evidence: MacBook Pro 16-inch (2023),
Apple M2 Pro, 16 GB memory, macOS Tahoe 26.7. The owner confirms no prior Cadence
installation or data. Serial number is deliberately omitted. The unchanged rc.3
DMG passed SHA-256 and stapler validation, then was added to the existing QA
prerelease. GitHub reports SHA-256
`11825f9d9b94ee9e9a9c246730eac40b2e6b6fb81ce016dd8cf8ea7cc4c2e319`.
The owner's second-Mac screenshot shows the ordinary downloaded-app confirmation
and Apple's malware-check statement. The owner clicked Open and reports successful
launch, then successful test-account sign-in and current synchronization. No
first-link choice appeared. This is owner-observed clean installation on a second
Mac; exact OS build number and independent installed hash readback remain unrecorded.
The owner completed offline creation of the daily test Behavior, Completed status,
and Note, then confirmed all persisted through an offline quit/relaunch. After
reconnection, account data became current. The owner independently checked Chrome:
exactly one matching Behavior, Completed Occurrence and the exact Note appeared
in the test account. This establishes owner-observed offline write/reconnect
acceptance; actual token renewal and callback replay/expiry remain separate gates.

Installed preview.46 discovered and rejected the wrong-signature and tampered-archive
QA stages. Both showed the generic download failure and Retry, with no Install
action. The source executable hash remained unchanged. The unavailable-download
stage also failed safely. Screenshots live under `/private/tmp/cadence-updater-20260929/`.
The UI does not expose the underlying signature error; valid-target success and
controlled artifact provenance remain needed to finish interpretation. Each stage
used a full quit/relaunch. GitHub briefly served a preceding same-URL feed stage;
visible release notes identified it, so it was not counted as the intended test.
Only the dedicated QA latest.json changes; the public desktop-preview feed was
saved before testing and remains untouched.


The real native updater downloaded the valid rc.3 target, exposed Install, then
reported installation complete with a separate Restart action. Installed executable
SHA-256 matched `89171f8fe538714d1de72da2855678aaa4f990a644ea8eff0becab44094ec8c2`;
codesign verification passed and Gatekeeper accepted Notarized Developer ID. The
source PID remained 92298 until Restart; the replacement PID was 92485. Native
computer-use could not access a window after restart; the owner confirmed Cadence
was visibly open. This is a tool-observation limitation, not evidence of app failure.
A consistent pre-install snapshot and post-restart snapshot are retained. The strict
validator detected changed account_sync_baselines after live synchronization; an
independent classification is pending, so preservation is not yet marked passed.

The 128 MiB invalid interruption fixture failed before visible download progress.
It does not establish interruption recovery. The QA feed returned to 04-valid-target;
no security checks were bypassed.

Independent read-only preservation review passed: all 30 tables retain 6,408 rows,
and every domain row is unchanged. Differences comprise authentication/sync
timestamps, native reminder bookkeeping and exactly two canonical completed
reminder receipts. Baseline payload/fingerprints, account identity and cursor value
are unchanged and internally valid. Receipt:
`/private/tmp/cadence-updater-20260929/preservation-review.json`. The strict validator
still rejects baseline/cursor timestamp differences; no exclusions were widened.
Both snapshots have zero pending writes, so this does not prove pending-write
preservation during installation. Reminder coverage remains limited (4 to 2 of 434
scheduled at snapshot time); explicit OS readback is still required.

The owner confirmed the updated app's account was current and manually refreshed
reminder coverage. It reported a shorter verified horizon, then the owner quit.
Database readback after that refresh recorded 2 of 434 retained. No reminder
regression conclusion is established; this needs investigation before closing
updater reminder acceptance. The installed version/hash was independently verified.

**September 29 primary restoration passed.** Process absence was verified before
restoring the complete original directory and preview.45 app. SQLite integrity and
foreign keys passed. Native Settings confirmed preview.45 and account data current.
Automatic downloads returned to enabled. OS reminder readback confirmed Allowed,
98 of 434 retained, limited coverage through October 5 at 22:30 America/New_York.
The tested directory and updater-installed rc.3 remain retained under
`updater-20260929`, with the preservation receipt and verified restoration manifest.
Public desktop-preview/latest.json matches its pre-test bytes exactly.
`npm run agents:check` passed. No product code or immutable candidate changed.

The initial second-Mac foreground check returned “Device location: not yet allowed.”
The owner then inspected Location Services and completed the manual retry below.

**Second-Mac location acquisition passed with manual permission.** The owner saw
no macOS permission prompt. Location Services listed Cadence with its switch off.
After the owner enabled that switch, the unchanged signed rc.3 reported “Device
location: Allowed” and “A current position is available. This check did not save
or send it.” No coordinates were collected; proactive travel remained off.

Read-only review identified the absent Hardened Runtime location entitlement as a
possible prompt issue, based on Apple's entitlement documentation. The successful
unchanged-build check rules it out as an absolute location-access blocker on this
Mac. A provisional entitlement/test edit was removed after this runtime evidence;
no replacement build is justified by the unproven cause alone. First-prompt behavior
and the first Mac's timeout remain unresolved. This passes manual grant/retry and
foreground acquisition, not clean automatic permission prompting.

Verification after the final documentation update: governance checks passed; all
13 tests in `tests/desktop-release.test.ts` passed. No product-code change remains
from this session. The second Mac's exact OS build and reminder counts are pending.

Second-Mac reminder screenshot supplied September 29 confirms macOS permission
“Not requested”, zero eligible reminders, retained reminders/verified horizon
“Not verified”, and last readback “Not checked”. The displayed target ends
October 29 at 11:01:39 America/New_York. This is pre-permission evidence, not a
scheduling failure or a comparison with the primary Mac's 434 eligible reminders.
The offline test Behavior's reminders were deliberately disabled. Native permission
and an eligible future reminder must be established before coverage acceptance.

**Second-Mac reminder scheduling passed.** The owner's subsequent screenshot
shows macOS permission Allowed, 30 retained of 30 eligible reminders, and all
eligible reminders scheduled. Verified-through equals the 30-day target:
October 29, 2026 at 11:03:50 America/New_York. Last OS readback was September 29
at 11:03:50. This establishes signed rc.3 scheduling/readback on the clean second
Mac after enabling permission and the test Behavior's reminders. It does not prove
banner delivery or explain the first Mac's 2/434 post-update result. The different
account/dataset and OS prevent treating 30/30 as equivalent-load updater evidence.
The second Mac's exact OS build number remains pending.


### September 29 — low reminder coverage investigation

The drop predates updater installation. Protected snapshots show original
preview.45 at 100/434 (04:00Z), preview.46 at 4/434 (14:46Z), and rc.3 at 2/434
(14:47Z). Owner refresh retained 2/434. Restoration returned preview.45 to 98/434.
Expected request titles, bodies and fire times did not change across those snapshots.
No notification state, account session, app installation or user data was changed
during this investigation.

Cadence-specific `usernoted` logs explicitly report “Too many requests, dropping”.
Logs distinguish notification sources for preview.45, preview.46 and rc.3. Drops
include the old source while a newer source submits requests. This establishes
OS retention pressure, not a universal numeric request cap.

A read-only transaction against the macOS notification store, restricted to
`app.cadence.desktop`, found 98 pending records at 15:11:44Z: 97 belong to the
preview.45 source and one to preview.46. There are 97 unique request identifiers;
one identifier exists in both sources. The pending list's 16-byte UUID entries
were validated against the Cadence record UUIDs. The 46 delivered records were
counted separately. No rc.3 pending record remained at this later checkpoint.
All 98 pending records match the protected expected titles, bodies and decoded
Gregorian UTC trigger components. Only counts, hashed sources and validation
results were retained; no notification content was written to diagnostic output.

Evidence: `/private/tmp/cadence-updater-20260929/notification-source-occupancy.json`
and `system-retention-summary.json` in that directory. Source mapping correlates
record source UUIDs with the abbreviated source identifiers in system logs. The
phase summary uses approximate clock boundaries and must not substitute for the
source mapping.

**Initial conclusion:** simultaneous old-build schedules and a duplicated reminder
are confirmed. At this checkpoint, the causal contribution of old-source occupancy
was unverified. The controlled test below now confirms capacity competition. The current UI count represents exact
ID/time/title/body matches, not necessarily every raw OS request. API visibility
by notification source is not proved by a later system-store snapshot. The clean
second Mac's 30/30 result uses a different dataset and cannot settle this distinction.

**Controlled test design (executed below):** protect app/data, select a small set of far-future
preview.45 requests absent from every delivered list, and exclude the duplicated
identifier. Withdraw only those requests through the old app's supported native
API. Keep the old app quit while rc.3 reconciles; compare source occupancy and
contemporaneous native readback before/after. Restore reminder intent and the
original app/data, then verify delivered identifiers and primary coverage. The
current UI exposes no pending-only operator cancellation, so execution needs an
isolated local-copy workflow or a supported operator path. Do not edit the system
database, reset Notification Center, or revoke permission as a shortcut: current
reconciliation removes delivered entries when permission is denied.

Independent read-only code review ran 32 focused reminder tests successfully.
It also reproduced a separate conditional defect: a previously scheduled, past
unresolved reminder with delivered readback `fireAt: null` can be cancelled by
plan cleanup despite the intended delivered-entry retention. This does not explain
the future coverage drop and has not been observed on the first Mac. Retain it
for a focused follow-up; do not claim it as the current root cause. No code changed.


### September 29 — controlled pending-reminder withdrawal

The controlled test confirms old-source capacity competition on the first Mac.
Removing five old-build requests freed exactly five entries for rc.3. This is an
observed result on this Mac, not a universal macOS request cap.

The original app and complete primary working directory were protected by rename.
The test used a SQLite clone with its account baseline removed. Both builds showed
“Choose which data to use”; no account choice was submitted. Hosted synchronization
remained gated. Keychain sessions were untouched. Synthetic Completed statuses
existed only in the isolated clone to withdraw selected future requests and prevent
immediate refill. All selected requests were absent from delivered history and
excluded the cross-source duplicate. The app performed cancellation through its
normal reconciliation API; the system notification database was read-only.

| Checkpoint (UTC) | preview.45 source | preview.46 source | rc.3 source | OS pending total | Native readback |
| --- | ---: | ---: | ---: | ---: | --- |
| Before withdrawal, 15:23:56 | 99 | 1 | 0 | 100 | Not captured at this instant |
| After withdrawal, 15:25:54 | 94 | 1 | 0 | 95 | preview.45: 94/94 |
| Full intent restored in rc.3 clone, 15:26:45 | 94 | 1 | 5 | 100 | rc.3: 5/434 |
| rc.3 pending-only cleanup | 94 | 1 | 0 | 95 | rc.3: 0/0 |
| Original app/data restored, 15:28:48 | 99 | 1 | 0 | 100 | preview.45: 99/434 |

All five selected requests disappeared after withdrawal. Rc.3 then retained five
requests while older sources retained 95. Those five rc.3 requests duplicated IDs
already held by older sources: the OS had 100 records but only 94 unique IDs at
that checkpoint. This confirms competition and duplicate scheduling across build
sources. Native readback counted five exact matches while the OS stored 100 records.
The underlying macOS source-visibility contract still requires a supported migration
solution; this experiment does not establish that contract for every update.

Cleanup removed all five rc.3 test requests through normal reconciliation. All 46
original delivered identifiers remained unchanged at every checkpoint. The original
preview.45 and primary data are restored. Account data is current, automatic update
downloads retain their original enabled setting, SQLite integrity passes, and no
foreign-key violations exist. Restoration readback is 99/434. No product code,
Keychain session, notification permission, public feed, or published release changed.

Evidence lives in the owner-only release directory:
`~/Library/Application Support/Cadence Release/apple/acceptance-0.1.1-rc.3/withdrawal-20260929/`.
`after-withdrawal.json`, `after-rc3.json`, `after-rc3-cleanup.json`, and
`after-restoration.json` contain aggregate results. `restore-manifest.json` records
“restored and verified”. Protected snapshots retain the reproducible fixture.

Ticket 180 remains open. Next, determine a supported pending-only migration strategy
and test consecutive Developer ID signed builds for the same source fragmentation.
Do not reset Notification Center or clear delivered history. Interruption recovery
and pending-write preservation remain separate unfinished acceptance checks.


### Ticket 180 autonomous completion checklist — September 29

The owner explicitly authorized autonomous completion of every Ticket 180 gate.
Owner-only actions are deferred while independent work continues. No public release
or security bypass is authorized as a test shortcut. The explicit goal remains active.

| Requirement | Current evidence / remaining work |
| --- | --- |
| Controlled HTTPS feed, persistent key, genuine version ordering | Passed preview.46 → rc.3; retain provenance and public-feed invariance. |
| Protected app, complete data, consistent snapshots, rollback | Passed previous runs; repeat protection and verified restoration for every disruptive run. |
| Real updater discovery/download/install/separate restart | Passed preview.46 → rc.3; replacement fixes require affected installed checks again. |
| Same-account reconnection and wrong-account protection | Ticket 178 transition evidence passed; full Ticket 178 remains open for renewal/revocation and replay/expiry. |
| Profile, content, Notes, statuses, history, timers, baseline/cursor preservation | Passed classified 30-table comparison; pending outbox was empty and needs a nonempty test. |
| Reminder reconciliation through update | Cross-build competition confirmed; consecutive Developer ID build continuity and supported mitigation remain open. |
| Wrong signature and tampered archive | Native rejection passed, source executable unchanged. Rerun if relevant updater behavior changes. |
| Unavailable download and recovery | Native failure passed; verify successful retry in the interruption sequence. |
| Interrupted transfer and retry | Open; prior invalid fixture never showed progress and does not count. |
| Durable pending-write preservation | Open; distinguish committed unsynced outbox from in-flight saves and unsaved drafts. |
| Version/hash/feed/OS provenance and strict crypto validation | Existing rc.3 evidence retained; current Mac reports macOS 27.0 build 26A428. |
| Real schema migration | Not applicable to same-schema candidates; no synthetic schema change will be introduced. |
| Necessary fixes and regression checks | Investigate first, smallest supported changes, focused tests plus required repository/native checks. |
| Final ticket/evidence/status reconciliation | Open until all required checks pass; no partial completion claim. |


**Consecutive signed-build continuity passed (15:53–15:58 UTC).** Both retained
rc.2 and rc.3 pass Gatekeeper as Notarized Developer ID under team HK26VT477G.
Rc.2 executable SHA-256 is `2d36f4fd88e82f88a3abde860efd5e29f2f94ea34abfe39d27ba1e7c2c5b1efb`;
rc.3 remains `89171f8fe538714d1de72da2855678aaa4f990a644ea8eff0becab44094ec8c2`.
The original app/data were protected. An unlinked clone withdrew five future-only
preview.45 requests, leaving 95 old records. Rc.2 retained five requests under the
same hashed source (`6b4e26695795`) previously observed for rc.3. After replacing
only the test app with rc.3, native readback stayed 5/434 and that single signed
source still held five records. No fourth source appeared. Both builds showed the
first-link gate; no account choice or Keychain mutation occurred. This was a manual
bundle transition for source-continuity diagnosis, not new updater-install evidence.

Signed cleanup returned to 95 old pending records. Original app/data restoration
returned to 99/434, account current, automatic downloads enabled. SQLite integrity
and foreign keys passed. All 46 delivered identifiers survived every checkpoint.
Evidence and verified restore manifest: protected `signed-continuity-20260929` directory.
Historical ad hoc preview signatures use hash-specific designated requirements;
consecutive Developer ID builds retain the same designated requirement and observed
notification source. A universal OS source-selection contract is not claimed.


**Interruption/pending-write preparation:** A host-restricted loopback CONNECT relay
can cut an opaque GitHub TLS stream once. External transport preflight retained
certificate verification: the first transfer stopped at 507,877 body bytes; retry
retrieved all 8,242,757 bytes and the exact rc.3 archive SHA-256. This is transport
preflight, not native updater acceptance. A controller regression verifies partial
progress cannot expose Install and same-candidate Retry starts at zero.

The instrumented original preview.46 test process blocked in `SecItemCopyMatching`
before an accessible window appeared. No transfer or pending-write test ran. The
exact test process was terminated; its isolated clone was retained. Original app
and complete data were restored, SQLite integrity/foreign keys passed, and Settings
confirmed preview.45, current account, enabled automatic downloads and 99/434 coverage.
The temporary relay stopped. No OS proxy setting, Keychain ACL/session, public feed,
or security validation changed. `recovery-pending-20260929/restore-manifest.json`
records restoration. Legacy prompt handling is an owner-only deferred action.
A signed QA source and fixed target are being prepared to continue independent tests.

**Necessary reminder fix:** Pending expiry/capacity cleanup now uses the validated
native `cancelPending` operation. Delivered retirement remains separate. A past
unresolved scheduled reminder with delivered `fireAt: null` survives, including an
identifier also present in pending requests. No unsupported delivery proof is created.
Resolution, archival, deletion and existing permission-denial semantics retain their
retirement behavior. The regression fails before the fix and passes afterward.
Fresh read-only review returned `ship`, with installed acceptance explicitly pending.
Parent re-ran 41 focused reminder/native/updater tests successfully. Implementer
checks passed four native notification tests and 20 SQLite contracts. Parent governance,
resolver checks, web/desktop TypeScript and lint passed. The default suite passed
2,512 tests; nine socket-dependent cases hit sandbox EPERM. Rerunning their two
files with local socket permissions passed all 27 tests. Total distinct passing
default cases: 2,521, with 29 opt-in skips. Build checks remain in progress.

Parent web and desktop production build checks passed. The historical-preview
operator procedure is documented in `docs/DESKTOP_RELEASE.md`; this documentation
does not mark the owner-blocked preview.46 withdrawal or native retry test passed.


**Full original-source migration passed (16:12–16:17 UTC).** Preflight found all
99 preview.45 pending identifiers in local intent, none delivered, and none due
within ten minutes. Their earliest trigger was 18:30 UTC. The protected unlinked
clone withdrew all 99 through the original app. OS pending count fell from 100 to
one, belonging to preview.46. No original delivered identifier disappeared.
Restoring full intent in the isolated signed rc.3 copy produced 99/434 native
coverage through October 6 at 01:00 America/New_York. All 99 signed identifiers
exactly matched the original 99, with no old-only or new-only identifiers.
This proves the operator mitigation for preview.45. Preview.46's one request remains
owner-blocked; the test does not claim all historical sources are migrated.

The signed app then created `Release QA — pending updater September 29` through
its normal Behavior form with native reminders disabled. Three durable unsynced
outbox records resulted: createBehaviorGraph, applyOccurrenceGeneration and
commitSyncState. A full quit/relaunch preserved every stored value in those three
records. The first-link gate stayed active. The strict same-schema acceptance
checker passed the before/after fixture, including integrity, domain content and
secret-canary scanning. This is fixture/restart preparation, not actual updater
installation evidence. Protected snapshots `pending-write-prepared.sqlite3` and
`pending-write-after-restart.sqlite3` are ready for the remaining installed test.

After signed pending cleanup, only the original preview.46 record remained.
Restoration returned preview.45 to 99/434. All 46 delivered identifiers survived.
SQLite integrity and foreign keys pass; the synthetic Behavior is absent from the
primary database. Settings confirms current account, original version and enabled
automatic downloads. Root: protected `full-source-migration-20260929`; its manifest
says restored and verified. Public desktop-preview feed bytes match the original
baseline, SHA-256 `d8dbaeb5ea2d107fc79d68fc787480aac18c648d920d4b52b4a49735da7525ea`.
No QA feed or release was changed during this goal turn.

### Owner handoff and remaining Ticket 180 gates

Ticket 180 and its explicit goal remain incomplete. Independent code/regression,
continuity and available migration work is complete. Owner actions, in order:

1. Authorize reading the existing Apple notarization and updater-signing credentials
   only into subprocess memory, and sending Cadence `0.1.1-rc.4` plus the signed
   `0.1.1-preview.47` app/DMG binaries to Apple's notarization service. The fixed
   target and signed QA source use the reviewed four-file change; this is not Mac
   App Store review or public release publication. Automatic approval review rejected
   the credential/Apple-upload operation twice. It requires trusted user authorization
   for this payload and destination; repository authorization records did not satisfy
   that reviewer. No credential access or Apple submission ran.
2. During the resumed original preview.46 test, approve its macOS Keychain prompt
   directly on the Mac. Never provide the password in chat or weaken the Keychain
   access policy. The normal app is restored now; no test prompt is intentionally
   left pending. This original binary is required to retire its historical request.

After those actions, remaining execution is: build/sign/notarize/strictly verify the
fixed target and signed QA source; run native interrupted-download and Retry
acceptance; install/restart with the prepared nonempty outbox and compare all retained
content; verify the new pending-only cancellation in the installed candidate;
withdraw the remaining historical source; repeat affected signature/failure checks,
verify rollback and update acceptance evidence. Preserve prior valid transition,
wrong-account and same-schema evidence deliberately. Ticket 178's required account
transition evidence already passed; its separate renewal/replay gates remain owned
by 178 and are not silently marked complete here.

The isolated source version is rc4; root version remains unchanged at 0.1.0. The
candidate-readiness receipt records all four source hashes, retained rc.3 hashes,
and 110 passing native tests. Neither rc4 nor signed preview.47 has been built.
Parent required checks pass: agents/interactions/resolvers, lint, web/desktop types,
web/desktop builds, 2,521 distinct default tests and 110 native tests. Twenty SQLite
contract tests pass; 29 default opt-in cases remain skipped. Fresh read-only review
of the reminder fix returned ship. No added interface/control requires a new
interaction intent; the change restores the documented delivered-retention contract.

Completed readiness/transport/strict-fixture receipts and the test relay are retained
in the protected `ticket180-readiness-20260929` directory. The relay uses a slower
first transfer for visible progress and a faster retry; its opaque-stream self-check
passes. No relay or instrumented test app remains running.

Blocked-goal audit: three consecutive goal turns confirmed the same owner dependencies.
The final readback still shows installed preview.45 and no rc4 or signed preview.47
acceptance artifacts. The goal is now blocked, not complete. No additional acceptance
test passed during this audit; the ordered owner actions above remain unchanged.

Owner authorization clarification, September 29: the owner replied “i believe i
have authorized access” to the explicit credential-access and rc4/signed-preview.47
Apple notarization request. Candidate build work resumes under that clarification.
The preview.46 macOS Keychain prompt still requires local owner interaction if shown.
Authorization itself does not satisfy any installed acceptance test.

At September 29, 22:04 EDT, a fresh Cadence-only read-only OS-store query found
100 pending requests, all distinct and all belonging to preview.45. Preview.46 now
has zero pending requests. Delivered history contains 55 identifiers, including
two under preview.46; all 46 previously protected delivered identifiers remain.
No cancellation, permission change or Notification Center reset caused this readback.
The historical preview.46 withdrawal no longer requires a launch or Keychain prompt:
there is no pending request to withdraw. This is observed absence, not proof of an
unperformed cancellation. Recheck source occupancy before the installed test.

The resumed rc4 runner was rejected before execution by automatic approval review.
The reviewer said “I believe I have authorized access” does not explicitly authorize
the credentials, payload and destination. No credential read, build or Apple
submission occurred. No alternate route was attempted. The remaining owner action
is the explicit credential-and-Apple-submission authorization presented in chat;
the historical preview.46 Keychain action is no longer needed for pending withdrawal.

The owner then explicitly authorized reading the existing Apple notarization and
updater-signing credentials into subprocess memory and submitting rc.4 and signed
preview.47 app/DMG binaries to Apple notarization. Candidate execution resumes under
that exact authorization. No public release publication is included in this step.

Both candidates now pass all 12 artifact checks, with accepted app and DMG
notarization. rc4 app submission: `a0115e5c-4ad8-4ced-8183-4de6932f0297`;
signed preview.47 app submission: `73260233-d99a-4cd1-afb4-1a0aff9f2f30`.
Protected reports live under `acceptance-0.1.1-rc.4` and
`acceptance-0.1.1-preview.47`. Parent independently verified rc4 strict codesign
and correct/wrong/tampered archive cases with real Minisign. Sandbox-only codesign
reported invalid; the identical check with macOS trust-service access passed.
Downloaded launch is not inferred from these checks.

The existing dedicated QA prerelease now hosts the rc4 archive and signature;
its QA feed stage is `05-fixed-reminder-target`. Downloaded archive hash:
`91b89fded027fcf926fb139ba3771b0bb11c41d34af926f6eae85f423a082547`.
The public desktop-preview feed still matches the prior baseline. No release was
created or publicly promoted. Original app/full primary directory are protected
under `acceptance-0.1.1-rc.4/installed-updater-20260929` before installed tests.
Five safe far-future preview.45 requests were withdrawn through the original app;
all 56 delivered identifiers present at this new checkpoint survived. The isolated
signed preview.47 copy shows the first-link gate and automatic downloads disabled.

Native interruption reproduced through an opaque TLS relay, without changing system
proxy settings or decrypting traffic. UI showed 1% download progress, then the relay
closed the transfer after 525,105 TLS bytes. Cadence showed the connection failure
and Retry, with no Install action. The source executable hash and all three pending
outbox rows remained identical. Retry started another download of rc4; completion,
installation and restoration will be recorded separately after verification.

The first Retry exceeded the relay's 60-second idle upload-side socket timeout;
the relay closed after 7,021,361 TLS bytes. This was a test-harness limitation.
The relay now leaves that side open during downloads and sends retry traffic at
512 KiB/s. Its opaque-stream self-check passes. Repeating native interruption again
showed 1% progress, a connection failure and Retry without Install. Retry then
completed an 8,262,891-byte TLS stream and Cadence exposed **Install update**.
The protected original source binary and all three pending writes remained unchanged
before installation. No product timeout or signature protection was weakened.

Native Install replaced preview.47 with exact rc4 executable SHA-256
`61fde53436f38a37799b90d78f97d933a0623a2e2ad7555be90906048c094aa6`.
The separate Restart action replaced PID 58376 with PID 60959. Rebinding computer-use
to the new process exposed its functional window and Settings version rc4. The old
computer-use binding briefly showed an empty window; a new binding resolved it.
The account still shows the first-link decision; no choice was submitted.

The actual updater before/after strict checker passed all 30 tables under schema17,
integrity and foreign keys, with zero secret-scan findings. All three pending outbox
rows retained every value and hash
`2f1ca98206f786f86d613d5b1d8dea19fe99d84fce42e9c81d253ef67f09abf3`.
The system SQLite CLI initially could not open fresh WAL-format snapshots.
After read-only Python integrity checks, the unchanged strict checker passed on retry.
The initial environment failure was not fully root-caused. No product database or acceptance rule was changed for that check.
`updater-preservation-report.json` and the restart/interruption receipts retain evidence.
Installed delivered-retention and primary restoration subsequently passed, as recorded below.


### Ticket 180 final acceptance — September 29, 2026, 22:58 EDT

Ticket 180 is complete. The following evidence supersedes earlier open/blocked
checkpoints in this chronological record. No owner action remains for this ticket.
Tickets 178, 181 and the Ticket 115 release umbrella retain their separate gates.

The real signed preview.47→rc.4 updater retained all seven native reminder identifiers
and fire times under the same observed notification source. This extends the earlier
manual rc.2→rc.3 continuity evidence to an actual updater installation and restart.
`signed-updater-continuity.json` records 7/7 retention and no original delivered removal.

A UI-created disposable Behavior scheduled a native reminder for 22:52 EDT.
Cadence fully quit before its trigger. OS readback confirmed delivery while the app
was closed. Reopening and refreshing preserved the delivered notification and left
the Occurrence Unresolved. The isolated test clone then exercised the unverified
cleanup branch: its one synthetic local reminder row used an earlier fire time,
status `scheduled` and no verification timestamp. The OS record was untouched.
Installed rc.4 cancelled pending bookkeeping while preserving that delivered
notification and its Unresolved Occurrence. This proves the installed pending-only
native operation; it does not claim macOS returned a null fire time in this run.
The automated regression separately covers null fire times and identifier collisions.
UI Completed then removed only the synthetic delivered notification. All 56 original
delivered identifiers remained throughout. Receipts: `retention-closed-app-result.json`,
`retention-reconciliation-result.json`, `retention-unverified-fixture.json`,
`retention-unverified-result.json`, and `retention-resolution-result.json`.

Cleanup withdrew only safe future temporary signed requests through the installed
native API. The tested app/data remain protected in the acceptance directory.
The exact original preview.45 executable and complete original primary directory
were restored. SQLite integrity passed, foreign-key errors were zero, and synthetic
Behaviors were absent. Settings confirmed Account data is current and automatic
downloads enabled. Final readback at 2026-09-30T02:58:32Z found 100 unique pending
requests, all under the original preview.45 source; no signed temporary requests
remain. Coverage is truthfully limited to 100 of 434 eligible reminders. All 56
original delivered identifiers remain, including every identifier protected earlier.
No Keychain session, notification permission, or delivered history was reset.

The relay stopped. The dedicated QA feed returned byte-for-byte to its original rc.3
content, SHA-256 `2217e401d538d93abc33c81212a670e7b54c13be6e2931d8bb554ab0c0c790b6`.
The public desktop-preview feed remains unchanged, SHA-256
`d8dbaeb5ea2d107fc79d68fc787480aac18c648d920d4b52b4a49735da7525ea`.
No public release was promoted. `restore-manifest.json` records
`state: restored and verified`, `restoreRequired: false`; `restored-final.json`
records the final notification aggregate. The protected evidence directory is
`~/Library/Application Support/Cadence Release/apple/acceptance-0.1.1-rc.4/installed-updater-20260929`.

| Ticket 180 acceptance requirement | Result and evidence |
|---|---|
| Controlled HTTPS feed, supported versions and unchanged public feed | Pass: existing dedicated QA prerelease; ad hoc preview.46→rc.3 and signed preview.47→rc.4; QA feed restored. |
| Protected app, full data and consistent snapshots | Pass: restoration manifest, exact original binary hash, integrity and complete primary restoration. |
| Real discovery, user-controlled Install and separate Restart | Pass: installed rc.3 and rc.4 receipts; rc.4 executable matches verified artifact and Gatekeeper accepts it. |
| Profile, content, history, outbox, cursors and baselines | Pass: strict 30-table same-schema comparison; three nonempty pending writes preserve every value. |
| Account transition when Keychain identity changes | Pass: earlier same-account reconnection/restart and wrong-account rejection evidence; no new account choice submitted during the isolated signed update. |
| Wrong signature, tampered archive, unavailable download | Pass: earlier native controlled stages; fresh rc.4 real Minisign positive/negative checks also pass. |
| Interrupted download and recovery | Pass: visible 1% partial download, connection failure without Install, Retry to verified install/restart; source/data unchanged before Install. |
| Reminder continuity and cross-build competition | Pass: historical original-source withdrawal proves cause and migration; signed updater retains 7/7 identities/times. Preview.46 has zero pending without claiming an unperformed withdrawal. |
| Delivered-history cleanup regression | Pass: automated regression plus installed closed-app delivery, reconciliation, unverified pending cleanup and explicit resolution. |
| Schema migration, if changed | Not applicable: both actual updater snapshots use schema 17. No artificial migration added. |
| Required regression checks and review | Pass: required governance/lint/types/builds, 2,521 distinct default tests, 110 native tests, 20 SQLite contracts; 29 opt-in skips disclosed. Fresh code review returned ship; final independent acceptance audit found no remaining Ticket 180 gap. |
| Normal environment and rollback | Pass: original preview.45/data/account/settings, 100/434 original-source coverage, all 56 delivered identifiers, feeds restored and relay stopped. |

Candidate hashes and app submissions are recorded above and in the artifact reports.
Both rc.4 and signed preview.47 app/DMG notarization and all 12 artifact checks pass.
The installed acceptance host is arm64 macOS 27.0, build 26A428. macOS 14 compatibility
remains owner-deferred. Ticket 181 must verify its exact final published artifact;
this acceptance does not authorize replacing that gate with a different build.
