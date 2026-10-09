# Apple-trusted macOS distribution implementation plan

> **Execution:** Owner authorized every plan step on September 27, 2026, including computer/browser use. Execution is in progress. Preserve acceptance gates and any tool-required credential handoff.

**Goal:** Complete the existing Apple-dependent desktop release gates now that membership is available.

**Source of truth:** `docs/TICKETS.md` Ticket 115, `docs/DESKTOP_RELEASE.md`, `docs/DESKTOP_BUILD.md`, and the linked acceptance records below.

**Architecture:** Reuse the existing Tauri release helper, persistent updater key, native adapters, and acceptance records. Keep `app.cadence.desktop` and the existing database identity. No new distribution service or CI pipeline is needed.

**Tech stack:** Tauri v2, Rust/Objective-C, macOS Keychain, Developer ID, Apple notarization, SQLite, and the existing GitHub updater feed.

## Historical pre-execution baseline — September 27, 2026

- The owner's supplied Apple account page confirms active individual membership and team `HK26VT477G`.
- The local `security find-identity -v -p codesigning` check returned zero valid identities. No private keys were read.
- The current host is arm64, macOS 27.0, build `26A428`. macOS 14 test-system availability remains unverified.
- The owner deferred macOS 14 runtime acceptance on September 27. Keep the declared and compiled macOS 14 minimum unchanged; do not claim macOS 14 compatibility from that metadata.
- Notarization credentials and portal certificate inventory were not inspected.
- Ticket 113's preview release and Tickets 118–122's preview authentication/sync work are complete. They remain complete.
- The working tree contains unrelated changes, including `STATUS.md`. Preserve them and select a reviewed source revision before building.
- Ticket 115 is in progress. Membership is resolved; certificate, credential, artifact, and installed acceptance work remains.

This baseline records the planning checkpoint. The current execution state in
`docs/qa/2026-09-27-apple-distribution.md` and `STATUS.md` supersedes it. Historical
records saying membership is unavailable also describe an earlier checkpoint.

## Blocker inventory

| Work | Existing owner/evidence | Effect of membership |
|---|---|---|
| Developer ID Application certificate and local signing identity | Ticket 115; `docs/DESKTOP_RELEASE.md` | Certificate setup can now proceed. No valid local identity exists in the current check. |
| Notarization credentials, submission, and stapling for app and DMG | Ticket 115; `apps/desktop/scripts/release.mjs` | Apple-dependent setup and submission can now proceed. No submission has run. |
| Downloaded, quarantined DMG installation and Gatekeeper launch | Ticket 115 | Now reachable after signed/notarized artifacts exist. Local signature checks alone do not close it. |
| Production Data Protection Keychain acceptance | Ticket 115; Tickets 118/122; `docs/qa/2026-08-31-desktop-authentication.md` | A signed build can now test the production path. Preview evidence covers only the legacy login Keychain. |
| Calendar pending-state Keychain acceptance | Ticket 115 dependency within Calendar acceptance; `docs/qa/google-calendar-capabilities.md` | Test `pending-calendar-state` in the same production build. Google provider approval remains independent. |
| Native device-location diagnosis | Ticket 165; `docs/qa/travel-release.md` | A Developer ID build can discriminate the signing hypothesis. Signing is not a confirmed fix. |
| Production upgrade and public distribution acceptance | Ticket 115; `docs/DESKTOP_RELEASE.md` | Can follow the signed candidate. Preview updater tests already passed; the production transition still needs evidence. |

Separate dependencies remain:

- **macOS 14 on Apple Silicon:** runtime testing is deferred and does not block Ticket 115. Keep the compiled deployment target at macOS 14; make no compatibility claim until a future test passes.
- **Native navigation handoff:** Ticket 165 still needs installed evidence, but the repository does not establish an Apple-membership dependency.
- **Google consent/verification, remaining Calendar/Daily Brief acceptance, and provider rollout:** track under their existing tickets. Membership does not close them.
- **Publication:** preparing a trusted candidate does not authorize changing the public preview feed or marketing claims.
- **App Store, TestFlight, iOS, Sign in with Apple, and APNs:** no previously blocked implementation was identified in the scoped project docs. Do not add them.

## Post-notarization execution — September 27, 2026

The owner requested a plan and immediate implementation of all five identified
workstreams, with independent tasks running in parallel. App and DMG notarization,
stapling, and strict artifact verification already pass for `0.1.1-rc.1`.
Reuse that exact candidate unless a verified source defect requires a replacement.

| Workstream | Owner and files | Parallel work | Live dependency and acceptance |
|---|---|---|---|
| Authentication and upgrade preservation | `signed_auth_acceptance`; `scripts/desktop-release-acceptance.mjs`, dedicated tests; parent owns live app | Add explicit same-schema acceptance, keeping default migration checks; test retained content and secret scanning | Protected backup and installation; initial comparison before sign-in; same-account login, restart persistence, offline launch, refresh and cleanup |
| Calendar | `signed_calendar_acceptance`; desktop Calendar lifecycle source/tests and `docs/qa/google-calendar-capabilities.md` | Audit connect/cancel/restart/replay and production pending-state cleanup; fix demonstrated defects | Production login first, then parent runs Calendar actions; distinguish Google approval from Apple signing |
| Location and reminders | `signed_native_acceptance`; native code/tests read-only and `docs/qa/travel-release.md` | Prepare exact existing probes and synthetic-data test steps; run relevant tests | Parent runs one live app: location outcomes without coordinate logs, navigation handoff, notification permission, quit delivery/activation, sleep/resume and OS-readback coverage |
| Download and installation | Parent; existing release helper and current QA record | Prepare a candidate-only loopback download, verify retained hashes and rollback | Fresh macOS account first, or owner-selected protected current-account acceptance; preserve browser quarantine and test normal Gatekeeper launch |
| Update and publication | Parent; `docs/DESKTOP_RELEASE.md`, existing release packet tooling | Inspect immutable candidate and current feed, prepare exact packet | Only after production account/data acceptance; verify real updater/restart and failure paths before changing public claims |

Execution order:

1. Preserve the current dirty tree, accepted candidate, updater key, rollback app,
   and SQLite backup. Record a new consistent database snapshot immediately before
   any installed transition; the earlier backup may no longer reflect current data.
2. Run the three independent code/test preparations above. Add minimal regressions
   before source fixes. Never share live app control between agents.
3. Download only the verified DMG through a browser. Compare its SHA-256 and record
   quarantine plus Gatekeeper evidence. Local download acceptance does not establish
   public HTTPS delivery; verify that separately at publication.
4. Complete fresh-install or owner-selected protected-account acceptance. Run the
   same-schema comparison before login/sync can create unrelated changes. Preserve
   profile, Notes, behavior/history, timers, pending writes, cursors, and baselines.
5. Test Google login and persistence, then Calendar. Run location and reminder
   tests sequentially in the same installed app. Record precise failures instead
   of treating signing as proof of functional acceptance.
6. Inspect any source diff and rerun focused checks. Obtain a fresh read-only review.
   If native or frontend code changes, build a new immutable candidate and repeat
   signing/notarization plus the affected installed checks.
7. Run all repository and release checks below. Prepare the reviewed publication
   packet and use the existing authorized release workflow only after its gates pass.

The owner directed reuse of the existing dedicated test email. The September 17
Calendar QA record identifies `cadence.testing.is@gmail.com` and documents the
protected backup, temporary desktop account switch, and primary-account restoration
workflow. Reuse that workflow under the current macOS account. Keep a fresh macOS-user
test explicitly unverified; do not create an OS user or treat a Google identity as one.

Current candidate gates are tracked in `docs/qa/2026-09-27-apple-distribution.md`.
The parent owns `STATUS.md` and shared release documentation. The Calendar agent
preserves existing unrelated changes in its QA file. Web and mobile behavior remain
unchanged; marketing retains its current preview disclosure until release acceptance.

## Ordered execution

Each numbered action is a separate step. Build, notarization, and device acceptance may take longer than local edits.

### 1. Establish the release inputs

**Files:** `docs/TICKETS.md`, `STATUS.md`, `docs/DESKTOP_RELEASE.md`; no app edits yet.

1. After execution authorization, mark Ticket 115 in progress while retaining its outstanding acceptance gates.
2. Select a reviewed source commit. Record source revision, intended release version, and current installed version.
3. Inventory existing portal certificates and local identities. Reuse a suitable identity before creating another.
4. Record the current Apple Silicon host's exact macOS version and build for candidate acceptance. Record macOS 14 runtime testing as deferred.
5. Reuse the existing updater key and verify its protected backup using the release runbook.

**Done:** inputs and ownership are recorded without secrets. No unrelated working-tree edits enter a release accidentally.

### 2. Prepare Apple signing and notarization

**Files:** protected local Keychain/credential storage; document nonsecret readiness in `docs/DESKTOP_RELEASE.md`.

1. Create a CSR only if no usable Developer ID identity exists.
2. Issue/download a **Developer ID Application** certificate and install it with its matching private key.
3. Verify the exact identity with `security find-identity -v -p codesigning`.
4. Select one existing supported notarization credential route. For a local release, prefer Apple ID plus an app-specific password unless an appropriate API key already exists.
5. Supply `APPLE_SIGNING_IDENTITY` and either `APPLE_ID`/`APPLE_PASSWORD`/`APPLE_TEAM_ID` or `APPLE_API_ISSUER`/`APPLE_API_KEY`/`APPLE_API_KEY_PATH` securely.

**Done:** the installed identity belongs to the intended team and the credential set is complete. Apple submission will establish credential acceptance later.

Developer ID serves direct distribution outside the Mac App Store. A Mac App Store listing is unnecessary for this release. See [Apple Developer ID](https://developer.apple.com/developer-id/) and [Tauri signing](https://v2.tauri.app/distribute/sign/macos/).

### 3. Close production Keychain configuration gaps

**Files:** `apps/desktop/src-tauri/tauri.conf.json`, proposed `apps/desktop/src-tauri/Entitlements.plist`, `apps/desktop/scripts/release-config.mjs`, `apps/desktop/scripts/release.mjs`.

**Inspect:** `apps/desktop/src-tauri/native/auth.m`, `apps/desktop/src-tauri/build.rs`, `apps/desktop/src-tauri/src/auth.rs`, `apps/desktop/src/account/auth.ts`.

**Tests:** `tests/desktop-release.test.ts`, `tests/desktop-release-cli.test.ts`, `tests/desktop-auth.test.tsx`.

The current Tauri configuration has no entitlements file. The production environment helper also inherits `CADENCE_LEGACY_KEYCHAIN_QA` from its caller. Artifact verification requires the legacy marker for previews, but does not reject it for production.

1. Confirm the app identifier and the team's App ID prefix from Apple's records. Do not assume every prefix equals the Team ID.
2. Configure only the application identifier and Keychain access-group entitlements required by Apple's production signing rules.
3. Create/embed a Developer ID provisioning profile where Apple requires authorization for those entitlements. Verify the final signed entitlements and profile agree.
4. Add a failing regression for a production build inheriting `CADENCE_LEGACY_KEYCHAIN_QA=1`.
5. Strip or reject that flag in the shared production environment helper. Preserve the intentional preview flag.
6. Add a production artifact regression that rejects the preview-only legacy Keychain marker. Implement the smallest verifier check.
7. Run the focused tests, then verify production Keychain write/read/delete using synthetic values in the signed app.

Apple describes provisioning authorization for Keychain access-group claims in [Creating distribution-signed code for macOS](https://developer.apple.com/documentation/xcode/creating-distribution-signed-code-for-the-mac).

**Done:** the signed candidate demonstrably uses the Data Protection Keychain. A certificate alone does not satisfy this gate.

### 4. Build and verify one production candidate

**Files:** release configuration above; ignored output in `apps/desktop/.release/`; evidence in `docs/DESKTOP_RELEASE.md`.

1. Set a candidate SemVer newer than the installed preview and intended feed version. The base config still says `0.1.0`; do not ship it unchanged as an upgrade.
2. Supply the existing updater key and reviewed public Supabase configuration through protected process inputs.
3. Run the repository and desktop checks listed below.
4. Run `node apps/desktop/scripts/release.mjs check` and classify every failure. Keep final interaction acceptance strict.
5. Run `node apps/desktop/scripts/release.mjs build` once the candidate prerequisites pass. This command submits to Apple for notarization.
6. Run `node apps/desktop/scripts/release.mjs verify apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle`.
7. Record Apple submission status, artifact hashes, version, source revision, entitlements, and verification results without credentials.

**Done:** app and DMG pass strict signatures, hardened runtime, stapling, Gatekeeper assessment, archive comparison, and updater signature verification.

If Apple rejects a submission, inspect its log and repair the identified issue. If stapling fails, resolve it before rebuilding updater artifacts. Never accept a skip-stapling workaround as final evidence.

### 5. Prove installed authentication and preview upgrade safety

**Files:** update `docs/qa/2026-08-31-desktop-authentication.md`, `docs/qa/2026-09-01-desktop-account-sync-release-acceptance.md`, and `docs/qa/google-calendar-capabilities.md` with dated evidence.

1. Protect the current SQLite database with a consistent backup. Retain the installed preview app for rollback.
2. Test a fresh signed installation in an isolated macOS account before replacing the daily-use app.
3. Exercise Google login, callback replay rejection, restart persistence, session refresh, offline launch, and disconnect cleanup.
4. Exercise Calendar connect/cancel/restart and `pending-calendar-state` cleanup through the production Keychain.
5. Test the installed preview-to-signed transition with a protected copy. The preview and production builds use different Keychain services.
6. Verify missing legacy credentials cannot silently discard linked metadata, pending writes, account baselines, or the local profile.
7. If a new sign-in is required, document it and prove safe reconnection before release. Do not add silent credential migration without demonstrated need.
8. Test a real updater installation, separate restart, data preservation, signature rejection, and network-failure recovery using an authorized controlled feed.

**Done:** production secure storage and upgrade behavior pass. Preserve history, Notes, timers, outbox/cursors, account identity, and notification reconciliation.

Use `scripts/desktop-release-acceptance.mjs` per its existing runbook with the candidate's actual schema version and synthetic secret canaries. Review its coverage against current migrations; the old schema-6 preview record is historical evidence only.

### 6. Resolve the native location hypothesis

**Files:** `docs/qa/travel-release.md`; inspect `apps/desktop/src-tauri/native/location.m` only if the signed test fails.

1. Test the existing location-permission action in the signed app on the owner's Mac.
2. Record prompt, denial, timeout, and successful-position outcomes without logging coordinates.
3. Test a fresh client on a second Mac if the owner's Mac still suppresses the prompt.
4. Attribute any remaining failure using those results. Do not claim Developer ID fixed Core Location before observing it.
5. Complete the existing installed navigation-handoff test under Ticket 165 separately.

**Done:** Ticket 165 has evidence or a narrowed blocker. Its current fallback remains available while diagnosis continues.

### 7. Complete distribution acceptance and prepare publication

**Files:** `docs/DESKTOP_RELEASE.md`, `docs/DESKTOP_PARITY.md`, `docs/TICKETS.md`, `STATUS.md`; marketing/user-guide files only when publication is authorized.

1. Arrange an owner-approved download location for the exact candidate without changing the current preview feed.
2. Download the notarized DMG in a browser. Preserve quarantine and verify normal installation and launch without Open Anyway.
3. Run the required acceptance matrix on the current Apple Silicon host. Record its exact macOS version and build against the tested candidate, including Keychain, offline tracking, reminders, and updates.
4. Verify notification permission, fully quit delivery, activation, sleep/resume, and truthful OS-readback coverage on the signed identity.
5. Run the strict final release check again after recording required interaction evidence.
6. Prepare exact release notes, download assets, hashes, feed changes, rollback procedure, and marketing copy for owner approval.
7. After all gates and explicit publication authorization, publish the reviewed packet and verify its downloaded artifacts.
8. Close Ticket 115 only with the required evidence. Update linked acceptance records without reopening completed preview tickets.

**Done:** distribution claims match the tested artifact and exact tested macOS version. Deferred macOS 14 runtime testing does not keep Ticket 115 open; do not claim compatibility with macOS 14 or untested newer versions.

## Validation commands for execution

For the release/configuration changes, run focused checks first:

```bash
npm run test -- tests/desktop-release.test.ts tests/desktop-release-cli.test.ts tests/desktop-auth.test.tsx
```

Before completing Ticket 115:

```bash
npm run agents:check
npm run interactions:check
npm run resolvers:check
npm run lint
npm run typecheck
npm run test
npm run build
npm run desktop:typecheck
npm run desktop:build
npm run desktop:native:test
npm run desktop:contract:test
npm run desktop:parity:check
npm run design-system:check
npm run marketing:check
npm run marketing:build
CADENCE_RELEASE_CRYPTO=1 npm exec -- vitest run tests/desktop-release-signature.test.ts
SUPABASE_TELEMETRY_DISABLED=1 CADENCE_SUPABASE_CONTRACT=1 npx vitest run tests/behavior-store-supabase.contract.test.ts
```

The Supabase contract requires the isolated local stack specified in `docs/OPERATIONS.md`. Never substitute hosted account data. Automated checks do not replace installed acceptance.

## Platform impact and boundaries

| Platform | Implementation, follow-up, or not-applicable reason |
|---|---|
| Web | No implementation change. Existing auth/sync contracts remain authoritative. |
| Desktop | Ticket 115 owns signing, production Keychain, notarization, and release acceptance. Ticket 165 retains location/navigation acceptance. |
| Marketing | Existing preview disclosure stays until Ticket 115 passes and publication is authorized. Reuse the current download surface. |
| Future mobile | Not applicable: macOS signing does not authorize or implement native mobile work. |

Use `interaction-registry.json` and `docs/DESKTOP_PARITY.md` for existing interaction evidence. Update the registry only if implementation changes an interaction.

The original planning pass created no credentials, signed no artifact, and submitted
nothing to Apple. Authorized execution has since issued the certificate, signed a
candidate, and submitted it to Apple. See the current QA record for remaining gates.
