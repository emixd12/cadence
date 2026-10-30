# Desktop release

Since October 8, 2026 (Ticket 186), the source repository is `emixd12/cadence`
(same repository ID) and the preview feed is
`https://github.com/emixd12/cadence/releases/download/desktop-preview/latest.json`.
Installed clients keep their original `habit-tracking-app` endpoints; GitHub
redirects them, and feed, archive and signature checks pass through the old URLs.
Do not create a repository named `habit-tracking-app`: that would end the redirects.
Historical release observations below retain their original names and URLs.
Evidence: `docs/qa/cadence-project-rename.md`.


Ticket 113 completed the unnotarized Apple Silicon preview and updater-
acceptance milestone on 2026-08-31. The preview uses ad hoc Apple code signing
and a persistent Tauri updater signing key. It does not claim Developer ID
signing, notarization, or macOS 14 compatibility. Apple-trusted distribution
requirements belong to Ticket 115, now in progress.

## Local app discovery and archive retention

Use `/Applications/Cadence.app` for everyday launches. On the development Mac,
exclude these folders in System Settings → Spotlight → Search Privacy:

- `apps/desktop/.release` in this repository.
- `apps/desktop/src-tauri/target` in this repository.
- `~/Library/Application Support/Cadence Release` for private rollback storage.

These exclusions were applied on September 19, 2026. Build and rollback copies
must not compete with the installed app in Spotlight. Keep the installed bundle
identifier and database location unchanged. Web, marketing, and future mobile
are not affected by this macOS release-tooling change.

After staging a verified preview, `release.mjs` keeps that preview unpacked and
prunes only older preview `.app` directories. Before any removal, it verifies
all retained archive, signature, and DMG hashes against their saved reports and
compares every archived file, permission, and symlink with the unpacked app.
A failed check prevents the entire removal batch. Archives, signatures, DMGs,
configuration, and reports remain. Existing version directories are never replaced.

To retry cleanup without rebuilding or providing signing credentials:

```bash
node apps/desktop/scripts/release.mjs preview-prune 0.1.1-preview.40
```

The argument names an existing unpacked preview to retain; newer previews also
remain. To reverify or launch an archived preview, first extract its existing
`Cadence.app.tar.gz` in its `bundle/macos` directory, then use `preview-verify`
with that version and bundle directory. For installation rollback copies, retain
a ZIP created with macOS `ditto --keepParent --sequesterRsrc`; verify restored
contents, permissions, symlinks, and extended attributes before removing the
unpacked copy. Keep database backups separate and unchanged.

The September 19 cleanup removed 15 older staged apps and archived 16 private
rollback apps. Its initial `mdfind` readback returned only the installed app,
but the owner's screenshot still showed six icons. Spotlight file-index
exclusion does not prove absence from the app picker: Launch Services retained
and rediscovered development/QA bundles.

The follow-up archived all six native build/QA bundles after restoring and
comparing their contents and macOS metadata, then unregistered their old paths.
The installed app remains unchanged. After verified preview staging, the release
script now also compares the staged archive with the native build copy and
removes that redundant unpacked copy. The newest staged preview remains under
the hidden `.release` folder for acceptance work.

After native QA, archive and verify temporary `.app` bundles, remove the unpacked
copies, and unregister those exact paths. Exclusions alone are insufficient.
Check Launch Services and the actual app picker, not only `mdfind`, before
claiming a single visible app. Do not reset the system-wide app registry or
empty Trash. Private rollback and Trash registrations were removed without
deleting Trash contents.

## Completed preview milestone

Preserve Cadence, `app.cadence.desktop`, and the existing local profile/database.
Build two explicit prerelease versions, initially `0.1.1-preview.1` and
`0.1.1-preview.2`. Keep generated public configuration, artifacts, hashes, and
verification reports in ignored `.release/preview/<version>/` directories.
Never include private keys, passwords, repository credentials, or user data.
No new backend, CI, helper, cloud login, or sync is part of this milestone.

Candidate-building prerequisites are separate from final acceptance. Preview
and production candidate builds must retain structural interaction checks,
identity/version validation, safe HTTPS configuration, hardened runtime, archive
validation, and real updater signature verification. The production `check`
command retains `check-interactions.mjs --desktop-release` and all Apple checks.
An interaction stays planned until its actual acceptance evidence exists.

The preview commands are `preview-check <version>`, `preview-build <version>`,
and `preview-verify <version> <bundle-directory>` in `release.mjs`. Preview
builds require `VITE_SUPABASE_URL` and either the public
`VITE_SUPABASE_PUBLISHABLE_KEY` or legacy `VITE_SUPABASE_ANON_KEY`; preflight
rejects missing, non-HTTPS, and secret/service-role configuration before Tauri runs.
The release helper builds the frontend with that reviewed environment, disables
Tauri's nested `beforeBuildCommand`, and rejects fresh frontend output that
omits either public value before Tauri runs. Native staged-app configured-state
acceptance remains the packaging and runtime gate.
Preview and local builds may omit `VITE_CALENDAR_BROKER_ORIGIN` deliberately.
Production `check` and `build` additionally require that public HTTPS origin.
Calendar, Daily Brief, and Travel share it; no separate Daily Brief origin exists.
Use `https://app.cadence-me.com` for the current production service.
The origin cannot include credentials, a path, a query, or a fragment.
Production preflight requires an exact `connect-src` entry in the reviewed native CSP.
The CSP retains the legacy broker for installed compatibility and permits the current origin.
Release tooling never adds arbitrary origins to the CSP.
Production builds reject fresh frontend output that omits the configured broker origin.
Build reports record public variable names and presence, without configuration values.
This evidence covers the fresh frontend before Tauri packaging, not installed service acceptance.
Preview verification requires a sealed ad hoc app, arm64, declared/compiled macOS 14
minimum, DMG integrity and matching contents, and a correctly signed updater
archive matching the verified app. Its report must state that Apple trust,
notarization, downloaded launch, live updater behavior, and untested macOS
versions are not established by local artifact checks.
Ad hoc preview builds must select the existing macOS login-Keychain session
path and contain its compiled verification marker. Production candidates must
not inherit that preview-only build flag; Apple-signed production uses the Data
Protection Keychain path.

The completed milestone uses the existing `emixd12/habit-tracking-app`
repository and dedicated prerelease tag `desktop-preview`, with a static feed:
`https://github.com/emixd12/habit-tracking-app/releases/download/desktop-preview/latest.json`.
Versioned asset names keep both candidates distinct. The prerelease does not use
GitHub's latest-release endpoint. The owner approved its exact release notes,
feed JSON, asset checksums, and upload plan. No repository credential belongs
in the feed or app.

Ticket 113 generated one persistent updater key after confirming no suitable
existing key. Its encrypted private key remains outside the repository with
owner-only access, and its password remains in a protected local channel. Never
print private key material or passwords. Reuse this key for future updates;
updater signing does not replace Developer ID signing or notarization.

The protected database backup preceded installation and update testing.
Downloaded DMG launch, real HTTPS update, tamper/signature rejection,
unavailable-download recovery, separate restart, and data preservation passed.
Apple's per-app approval handled the unnotarized download; no global Gatekeeper
change or quarantine removal ran. macOS 14 remains unverified.

The owner's 2026-08-31 statement authorizes the six exact assets in the
[asset checklist](qa/2026-08-30-desktop-asset-provenance.md) inside Cadence.
Existing MIT exclusions, reserved marks, and third-party notices remain intact.
The milestone does not authorize unrelated relicensing or future publication.

The two local candidates pass artifact verification. The dedicated
[desktop-preview prerelease](https://github.com/emixd12/habit-tracking-app/releases/tag/desktop-preview)
is public with eleven approved assets. A quarantined Safari download passed
macOS per-app approval. The real HTTPS `.1` to `.2` update passed signature,
tamper, unavailable-download, restart, and data-preservation acceptance on
macOS 26.5.2. See the [preview QA record](qa/2026-08-31-desktop-preview.md).
The approval packet is `apps/desktop/.release/preview/hosting/APPROVAL.md`, with
an explicit eleven-asset allowlist and five feed stages for real updater tests.
The packet discloses uncommitted build inputs and
the mismatch with the proposed baseline tag's automatic source archive.

September 28 controlled updater preparation adds one exact QA feed to preview
validation: `https://github.com/emixd12/cadence/releases/download/desktop-updater-qa-20260928/latest.json`.
The local `0.1.1-preview.46` source uses that endpoint, ad hoc signing, legacy
Keychain storage, and the existing persistent updater key. Its intended target is
the unchanged notarized rc.3. The staged packet lives under ignored
`.local/release-updater-qa-20260928`; its prepared assets and QA feed are published
on the separate QA prerelease. The unchanged rc.3 DMG is also available there for
second-Mac acceptance. Owner Keychain approval resolved source launch. Native
wrong-signature, tampered and unavailable-download cases failed safely; native
Install produced the exact notarized rc.3 executable. The owner confirmed the
separately restarted window opened. Ticket 180 subsequently passed
interruption recovery and remaining acceptance on September 29, as recorded below.
Keep the public preview feed unchanged. Run each same-version
stage after a full quit/relaunch and verify its visible release notes: GitHub may
briefly serve the preceding feed stage. See the dated QA record for preservation
and primary restoration results.

September 29 completion: signed preview.47→rc.4 passed real partial-download
failure, Retry, Install and separate Restart. Both candidates have accepted app/DMG
notarization and pass artifact verification. Strict same-schema comparison preserves
all 30 tables and three pending outbox rows; seven reminder identities/fire times
remain unchanged. Installed rc.4 preserves delivered history during pending cleanup.
The original preview.45 app/full primary data, account session and automatic-download
setting are restored and verified. All 56 protected delivered identifiers remain;
original-source readback is 100/434. The temporary relay is stopped. The dedicated
QA feed is restored to its original rc.3 bytes; the public preview feed is unchanged.
This closes Ticket 180, not final artifact publication under Ticket 181.

## Historical preview reminder migration

September 29 installed evidence distinguishes historical ad hoc previews from
Developer ID signed builds. Preview.45 and preview.46 retain separate pending
notification sources. Signed rc.2 and rc.3 share one observed source. Old pending
records can consume capacity and duplicate identifiers even when the new app's
readback cannot see them. Do not infer a universal request cap from one Mac.

Use the retained original binary to retire a historical source. Rebuilding or
re-signing an ad hoc helper changes its identity and does not establish access to
that source. Never edit the system notification database, reset Notification Center,
revoke notification permission, or clear delivered history as migration shortcuts.

For an operator-assisted transition:

1. Verify each original binary and protect the complete working directory, original
   app and a consistent SQLite snapshot. Keep a restoration manifest. Never run two
   Cadence copies concurrently.
2. Use an isolated local clone with account synchronization gated before any fixture
   change. Confirm the first-link gate in the installed app; never submit an account
   choice. Preserve the original Keychain sessions and hosted data.
3. Enumerate pending intent and delivered identifiers separately. Existing preview
   cancellation removes both. Withdraw only future identifiers absent from every
   delivered list, with enough time to finish before any selected trigger fires.
   Defer imminent or ambiguous identifiers; do not assume they are safe to delete.
4. Prevent immediate refill in the isolated clone, then let the original app reconcile
   through its native API. Verify the intended source emptied and every previously
   delivered identifier remains. Repeat for each accessible historical source.
   A Keychain prompt requires the owner; it does not authorize bypass or ACL changes.
5. Restore full reminder intent in the protected test data and run the signed target.
   Verify native readback, contiguous coverage and source occupancy. A truthful
   OS-limited horizon is acceptable; hidden old-source competition is not.
6. Retire temporary test requests, restore the exact primary app/data and verify
   integrity, account state, original settings and delivered identifiers before
   handing control back. Final migration and public publication are separate actions.

The validated `cancelPending` native operation now separates future scheduling
cleanup from delivered retirement. It cannot grant a new binary access to a
historical ad hoc source. Consecutive signed-build continuity passed on macOS 27.0
build 26A428; arbitrary future upgrades still require their release checks.
See `qa/2026-09-27-apple-distribution.md` for exact source counts and remaining gates.

## Signing-only upgrade acceptance

For an update that keeps its SQLite schema, use the explicit mode after protecting
consistent mode-0600 before/after snapshots:

```bash
CADENCE_DESKTOP_RELEASE_EXPECTED_SCHEMA_VERSION=17 \
CADENCE_DESKTOP_RELEASE_SECRET_CANARIES='["synthetic-acceptance-canary"]' \
npm run desktop:release:acceptance -- --same-schema /Applications/Cadence.app /private/path/before.sqlite3 /private/path/after.sqlite3
```

Set the expected version from the candidate's actual schema. Take the initial
checkpoint before sign-in, synchronization, or user edits. The checker requires
identical schemas and retained row content across every table; its report names
excluded launch-bookkeeping columns. It also excludes completed local receipts
for `commitNativeReminderPlan` and `recordNativeReminderCoverage` from content
comparison. Those receipts must contain the canonical lowercase SHA-256 JSON
string and exact sequence revision result, with nonempty `created_at` equal to
`synced_at`. The report retains total table counts and gives excluded receipt
counts for each operation. Pending, malformed, domain, and unknown outbox rows
must retain every stored value. New rows may appear; table counts cannot decrease.
Domain changes such as automatic archiving or occurrence regeneration must be
classified, not silently excluded. Default mode still requires a schema increase.
Synthetic canaries prove only the scanned synthetic values are absent; never claim
untested live secrets.

## Persistent updater key handoff

One persistent pair was generated on 2026-08-31 after checking the usual
`~/.tauri` directory, the release-key directory, and supplied environment.
Both files belong to the owner, have mode `0600`, and live outside the repository
in a mode `0700` directory:

- Private: `/Users/emi/Library/Application Support/Cadence Release/updater/cadence-updater.key`
- Public: `/Users/emi/Library/Application Support/Cadence Release/updater/cadence-updater.key.pub`
- SHA-256 of the decoded 32-byte public key:
  `71a12820ee0af1e2795f5f0db259d38276d49307597cf889d552ccd671ab9583`

The private file is encrypted with a generated password. The password is retained
in the macOS login Keychain, service **Cadence persistent updater signing key**,
account **emi**. Generation used hidden terminal prompts; no password argument,
plaintext handoff file, or secret log was created. Actual signing with the retained
password and independent Minisign verification passed. An empty password failed.

For backup, create a secure item in your password manager named **Cadence updater
signing key**. Attach both files using the file picker; use Go to Folder to enter
the directory above. Open Keychain Access, select the login keychain, search for
the service above, and open its item. Select **Show password**, authenticate, and
copy the password directly into the password manager's protected password field.
Do not paste it into a terminal, chat, issue, or document. Clear the clipboard
afterward. Record the fingerprint in the secure item's notes. Verify both
attachments and the password before removing any backup. Password-manager backup
is an owner action and is not yet verified. Keep the working key and Keychain item
for future releases; do not regenerate per version. Losing either prevents signing
updates for installed copies using this key. See [Tauri updater signing](https://v2.tauri.app/plugin/updater/).

Downloaded previews may trigger macOS warnings because Apple has not notarized
them. After attempting to open the app, use System Settings → Privacy & Security
→ **Open Anyway** only for the verified Cadence download. Follow the per-app
confirmation and authenticate if macOS requests it. A warning that the app will
damage the computer is not an ordinary unidentified-developer warning; stop and
inspect it. Never disable Gatekeeper globally or remove quarantine to count a
test as passed. See [Apple's per-app approval instructions](https://support.apple.com/102445).

## Identity and data

The final product name is **Cadence** and its identifier is
**app.cadence.desktop**. The local QA build now uses this final identity. The earlier
`app.cadence.desktop-spike` build was shut down after verified reminder cleanup.
`apps/desktop/scripts/release-config.mjs` also enforces the final identity in a
generated release overlay. It never edits the active `tauri.conf.json`.

The native identity-adoption migration preserves the spike database, stable
profile, history, outbox, and cursors. It backs up SQLite before adoption and
does not overwrite an existing product database. Actual local identity adoption passed on 2026-08-30, preserving the profile and
history while retaining the original database. This does not replace a signed
installed-app upgrade test. Record that test before release.
Cancel the spike app's pending notifications before its final shutdown during
identity transition. macOS scopes notification requests to the app identifier;
the new identifier cannot cancel requests owned by the spike identifier.

## Update behavior

Ticket 131 checks at startup and every 24 hours while open. Focus, visibility
resume, native resume, and connectivity recovery trigger overdue checks. The
last attempt persists; **Check for updates** bypasses the interval. Automatic
download is enabled by default and can be disabled in Settings.

A downloaded candidate stays available across navigation. **Review update** opens
release notes inline; **Later** snoozes that version for 24 hours. The user chooses
**Install update**, then separately **Restart Cadence**. Pending writes and account
operations block restart. Unsaved drafts require saving or explicit discard.
There is no downgrade override. Release notes render as plain text. A failed
installation never produces an installed state.

Tickets 129–130 use the existing manual updater for the first repair release.
Ticket 131 follows separately after repair acceptance. Its signed native lifecycle
and UI verification remain release gates.

The updater is disabled when the final identity, public key, or HTTPS feed is
absent. The native plugin rejects invalid signatures before installation.
macOS requires a restart to run the installed version. See the
[Tauri updater API](https://v2.tauri.app/reference/javascript/updater/) and
[signature verification implementation](https://raw.githubusercontent.com/tauri-apps/plugins-workspace/v2/plugins/updater/src/updater.rs).

Only the main window can check or download/install an update. It receives no
generic shell, filesystem, or HTTP plugin permission. Updater configuration
never permits insecure transport or invalid certificates.

## Local preparation

Provide real owner-controlled values through the shell environment. Do not
commit private keys, certificates, passwords, or generated release output.
The release commands do not create keys or publish artifacts. The optional
cryptographic fixture below creates disposable keys in memory only.

| Variable | Purpose |
|---|---|
| `CADENCE_UPDATER_ENDPOINT` | Public HTTPS updater feed URL; no placeholder or embedded credentials |
| `CADENCE_UPDATER_PUBLIC_KEY` | Full base64 Tauri public-key content, not its filename |
| `TAURI_SIGNING_PRIVATE_KEY` | Existing updater signing key, supplied directly to Tauri |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Key password when the key requires one |
| `APPLE_SIGNING_IDENTITY` | Valid `Developer ID Application:` identity installed in the local keychain |
| `CADENCE_APPLE_PROVISIONING_PROFILE` | Absolute path to the matching Developer ID provisioning profile; production embeds it at `Contents/embedded.provisionprofile` |
| `VITE_SUPABASE_URL` | Public HTTPS Supabase URL for preview and production account mode |
| `VITE_SUPABASE_PUBLISHABLE_KEY` or `VITE_SUPABASE_ANON_KEY` | Public Supabase key for preview and production account mode; never a service-role or secret key |
| `VITE_CALENDAR_BROKER_ORIGIN` | Required production public HTTPS service origin for Calendar, Daily Brief, and Travel; currently `https://app.cadence-me.com`; optional for previews/local builds |

Notarization also requires one complete credential set:

- `APPLE_ID`, `APPLE_PASSWORD` (app-specific password), and `APPLE_TEAM_ID`; or
- `APPLE_API_ISSUER`, `APPLE_API_KEY`, and `APPLE_API_KEY_PATH`.

Tauri documents these [signing and notarization credentials](https://v2.tauri.app/distribute/sign/macos/).
The release helper supports an installed local signing identity. Importing a
CI certificate or creating an Apple credential is a separate operation.

Production overlays use `src-tauri/Entitlements.plist` for Cadence's registered
App ID prefix `HK26VT477G` and private Keychain access group. The Apple portal
confirmed this prefix when `app.cadence.desktop` was registered on September 27.
Provisioning must authorize those entitlements. The same file grants the Hardened
Runtime location entitlement `com.apple.security.personal-information.location`
(Ticket 165). Apple lists it under Hardened Runtime resource access; the code
signature grants it and provisioning profiles do not list it. Preview overlays omit both the
entitlements and provisioning profile. Production child processes strip the
legacy-Keychain build flag, and production artifact verification rejects its
compiled marker. Installed Data Protection Keychain acceptance remains required.

Install Xcode command-line tools, Python 3 (standard library only), and the
[Minisign verification tool](https://jedisct1.github.io/minisign/) on the release
Mac. Minisign is a release tool; the app uses Tauri's built-in verifier.

From the repository root, use Node 24:

```bash
node apps/desktop/scripts/release.mjs check
node apps/desktop/scripts/release.mjs build
node apps/desktop/scripts/release.mjs verify apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle
```

`check` validates configuration, the local Developer ID identity, notarization
credentials, release tools, and `check-interactions.mjs --desktop-release`.
It does not contact the feed or prove credential acceptance by Apple. It fails
while applicable desktop interactions remain incomplete.

`build` checks candidate prerequisites without requiring final interaction
acceptance, writes public configuration under the ignored
`apps/desktop/.release/`, and invokes Tauri for `aarch64-apple-darwin` with app,
DMG, and signed updater artifacts. Tauri notarizes and staples the app. The release
helper then submits the signed DMG with `notarytool --wait`, requires `Accepted`,
and staples the DMG before strict artifact verification. Rejection or tooling failure
stops the command without a new verification report. Preview builds skip notarization.
It never uploads a public release or changes a provider.
The Tauri child receives `CI=true` and `TAURI_BUNDLER_DMG_IGNORE_CI=false`, so
its [DMG helper](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.4/crates/tauri-bundler/src/bundle/macos/dmg/mod.rs)
skips Finder AppleScript as well as credential prompts. The
macOS disk-image service must still be available to the build process.

`verify` requires the public updater configuration and expected
`APPLE_SIGNING_IDENTITY`; it does not need private signing/notarization secrets.
Standalone `verify` records frontend configuration as not verified by that command.
It checks the app identifier/version/architecture, signing authority, hardened
runtime, code signatures,
Gatekeeper acceptance, and stapled notarization for the app and DMG. For production,
`verify-entitlements.py` requires the signed entitlements to equal
`src-tauri/Entitlements.plist` exactly. The embedded provisioning profile must belong
to the same team, be unexpired, and authorize every entitlement except the
listed Hardened Runtime resource entitlements, which must be `true`. It decodes
Tauri's public-key/signature envelopes and asks Minisign to verify the updater
archive. It compares every file's bytes and permissions, directory, and symlink
target with the verified app. It rejects missing, surplus, duplicate, unsafe,
and unsupported entries without extracting archive-controlled paths. The resulting local JSON report lists
artifact hashes and explicitly excludes upgrade preservation and publication.

## Dev-signed builds

Use dev-signed builds to test desktop changes on the owner's Macs
(`docs/DECISIONS.md`, 2026-10-23). They carry the production Developer ID
signature, entitlements and provisioning profile, so Keychain sessions, location
permission and notifications use the same app identity as a release. The saved
Keychain session carried over from release 0.1.2 to the first dev build on October 23,
2026. Location and notification grants are expected to carry over too, not yet
verified. Dev builds have no
notarization, DMG or updater archive, and are never published. Ad hoc previews cannot
replace them: previews omit the entitlements, use the legacy login Keychain, and macOS
treats each preview as a new app.

Build from main, or from a branch whose SQLite migrations match `origin/main`, with
Node 24, then install:

```bash
"$HOME/Library/Application Support/Cadence Release/dev-signed-env.sh" node apps/desktop/scripts/release.mjs dev-build 0.1.6-dev.1
node apps/desktop/scripts/install-dev-build.mjs 0.1.6-dev.1
```

`dev-check <version>` runs the same preflight without building. The environment
helper lives outside the repository. It exports the public values, the stable feed,
`APPLE_SIGNING_IDENTITY` and `CADENCE_APPLE_PROVISIONING_PROFILE`, and unsets the
notarization credentials and the updater key. To recreate it, use the variables in
"Local preparation" without those secrets.

Number dev builds `X.Y.Z-dev.N` and never reuse one. `dev-build` requires `X.Y.Z`
above the source version in `tauri.conf.json`. Also keep `X.Y.Z` above every built
candidate: after the 0.1.5 candidate, use `0.1.6-dev.N`. Dev builds compile in the
stable feed, so the next published release replaces them through the normal updater,
and the feed never offers an older release.

`dev-build` gives the Tauri build no Apple credential and no updater key, so Tauri
signs ad hoc and cannot notarize. The command then signs the app with the Developer ID
identity, hardened runtime and `Entitlements.plist`, without a secure timestamp. Only
notarization needs a timestamp, and requesting one contacts Apple's timestamp server,
so no `dev-build` step contacts Apple. One signature covers the app because it has a
single executable; the command stops if the bundle gains nested code. It verifies the
Developer ID authority, hardened runtime, arm64, the macOS 14 minimum, the production
Keychain path, and that the signed entitlements and embedded profile match. It stages
the app and `dev-verification.json` in the Spotlight-excluded
`~/Library/Application Support/Cadence Release/dev-builds/<version>/` and removes the
build copy from the checkout. The report records the source commit, branch, clean
state, SQLite schema version and any migration that differs from `origin/main`.

`install-dev-build.mjs`:

1. Refuses a staged app that no longer matches its report or Developer ID signature,
   a version at or below the installed one, and migrations that differ from
   `origin/main`. Pass `--allow-unmerged-migrations` only on the owner's instruction:
   if such a migration changes before it merges, later builds cannot open the database.
2. Refuses while any Cadence build runs, including `desktop:dev`. It never quits
   Cadence, because quitting discards unsaved drafts.
3. Saves a consistent database copy (`before.sqlite3`) with its integrity,
   foreign-key, schema and row-count checks, and a ZIP of the installed app. They go
   to `~/Library/Application Support/Cadence Release/dev-installs/<UTC time>-<version>/`
   with modes 0700 and 0600. A failed check stops before installation.
4. Copies the new app beside `/Applications/Cadence.app` and swaps by rename. A failed
   swap or signature check puts the previous app back. It then removes the staged copy.
5. Opens the installed path, waits up to 60 seconds for the built schema, and checks
   an `after.sqlite3` copy. Fewer rows in a table produce a warning, not a failure,
   because account sync can delete rows. `--no-launch` skips this step.

Output names paths, hashes, versions, counts and check results, never record content.

To roll back, quit Cadence, keep the dev app, and restore the previous app from the
protected folder:

```bash
ditto -c -k --keepParent --sequesterRsrc /Applications/Cadence.app "<folder>/Cadence-<dev version>.zip"
rm -rf /Applications/Cadence.app
ditto -x -k "<folder>/Cadence-<previous version>.zip" /Applications
```

If the schema advanced, the previous app refuses the database ("The local database
needs a newer Cadence version."). Restoring `before.sqlite3` discards every change
made since the copy, so it needs the owner's instruction. With Cadence quit, delete
`cadence.sqlite3-wal` and `cadence.sqlite3-shm`, then copy `before.sqlite3` to
`cadence.sqlite3` with mode 0600.

Dev-signed builds do not establish notarization, Gatekeeper on a downloaded copy, the
DMG, updater installation from the feed, or macOS 14 compatibility. Those stay release
gates.

## Agent-run installed acceptance

The order of methods and the owner-only steps are in `AGENTS.md`, "Installed and live
acceptance". "Release acceptance" below says which checks a notarized release needs;
this section says how an agent runs installed checks. It is what the agent ran for
`0.1.6-dev.2` on October 24, 2026, recorded with the 0.1.5 candidate (PR #140). The
owner's hands were needed only to quit Cadence, sign in on the web and edit four Behaviors
on the Mac; window automation can replace the last of these.

Test devices, such as the test Mac on the last published release, are reached over
Tailscale SSH with `scripts/test-device.mjs`; setup and rules are in
[TEST_DEVICES.md](TEST_DEVICES.md).

### Install and readback

1. Build with `dev-build` (above). When it passes, ask the owner to quit Cadence,
   then run `node apps/desktop/scripts/install-dev-build.mjs <version>`.
2. Confirm the install: the installed `CFBundleShortVersionString`, the executable's
   SHA-256 against `binarySha256` in `dev-verification.json`, `codesign --verify
   --strict /Applications/Cadence.app`, and the before/after counts in the protected
   folder's `manifest.json`.
3. Wait for the launch sync (about 30 seconds) with a bounded loop on the sync cursor
   below. Do not poll by hand.

The rename swap needs no Launch Services refresh. After the `0.1.6-dev.2` install,
Launch Services resolved `app.cadence.desktop` to `/Applications/Cadence.app`, and the
running app was registered there. Stale records come from verification disk images and
temporary copies. After QA, unregister those exact paths with `lsregister -u`, as
"Local app discovery and archive retention" says.

### Read-only database queries

```bash
DB="$HOME/Library/Application Support/app.cadence.desktop/cadence.sqlite3"
q() { sqlite3 -readonly "file:$DB?mode=ro" "$1"; }
q "SELECT max(version) FROM schema_migrations;"                                # schema
q "SELECT max(updated_at) FROM sync_cursors WHERE name = 'account-sync';"     # last sync
q "SELECT count(*) FROM mutation_outbox WHERE synced_at IS NULL;"              # pending writes
q "SELECT operation, count(*), max(synced_at) FROM mutation_outbox WHERE created_at > '<UTC time>' GROUP BY operation;"
```

These work while Cadence runs. Once it has quit and removed its `-shm` file, a
read-only open fails with "unable to open database file (14)". Read the installer's
protected copies instead. A `sqlite3 .backup` copy keeps WAL mode and fails the same
way until it is set to `PRAGMA journal_mode=DELETE`. Never write to the live database.
To confirm the web session and the Mac use one account, compare the SHA-256 of the
lowercased email in `account_link_metadata` with the web session's. Never print the
address.

### How desktop sync runs

Account sync runs at launch, after a local edit, when the network comes back, on
Timeline reload, and on Settings › Account synchronization › **Sync now**. A failed
sync retries with backoff of up to 30 seconds. There is no periodic timer, so a web
change reaches the Mac only after one of these (`apps/desktop/src/product.tsx`).

### Where round trip

1. Web, in the in-app browser after the owner signs in: create `Where test 1`–`4` with
   Where Not set, Anywhere, Home and A place (with place text). Turn off Browser
   notifications and leave Email reminder off. The "Create behavior" section closes
   after each save, so open it again. Click the checkboxes, because filling them
   programmatically does not update the form state. A save can take about 5 seconds.
2. Mac: **Sync now**. Then read
   `SELECT title, coalesce(where_kind, 'not set'), coalesce(location_text, '-'), browser_reminder_enabled FROM behaviors WHERE title LIKE 'Where test %' ORDER BY title;`.
3. Mac: change test 1 to A place, 2 to Home, 3 to Not set and 4 to Anywhere, then
   **Sync now**. Expect `updateBehaviorGraph` rows synced and no pending rows.
4. Web: reload, open **Details and Settings** for each, and read the Where select and
   place text.
5. Archive the four on the web with **Archive behavior**; never delete. Check that the
   active and archived counts return. After the next Mac sync, the rows have
   `active = 0` and an `archived_at`.

### Connector check

- Hosted state, through the web session:
  `GET /api/{hevy,outlook-calendar,icloud-calendar,google-calendar}/connection`
  returns `not_configured`, `disconnected`, `connected` or `reconnect_required`. The
  desktop reads the same routes.
- Production configuration, names only: `vercel env ls production` lists
  `CONNECTOR_CREDENTIAL_*` and `OUTLOOK_CALENDAR_*` when the connectors are set up.
- Desktop cache, counts only: `calendar-cache.sqlite3` has one `connector_fence` row
  per source once the connector code has run. `connector_snapshot` gains rows after
  a connected source refreshes. Disconnecting or switching accounts clears them.
- Panels: read the Settings text through the window's accessibility tree (below).

### Reading the Mac window

System Events exposes the WKWebView accessibility tree to JavaScript for Automation:
process `cadence-desktop-spike`, `windows[0]`, then walk `uiElements()` and read each
element's `role()`, `name()`, `description()` and `value()`. Reading the visible
screen needs no click. This is how the agent confirmed the three Connect buttons and
"Device location: not yet allowed." on dev.2. The host app needs macOS Accessibility
permission, and the Cadence window must be open. Use Computer Use, when this session
has it, for clicks such as **Sync now**. The location prompt itself stays with the
owner: it answers a permission prompt, and turning Travel estimates on changes a
synced setting.

### Location checks

- Read what happened from the unified log, not from the screen. Use `/usr/bin/log`,
  because in zsh `log` is a builtin. Cadence's "cadence location result" lines are
  info level, so start `/usr/bin/log stream --level info` before the test; `log show`
  later will not have them. CoreLocationAgent logs "handle auth-prompt" when the
  prompt appears and "AuthPrompt response" when it is answered. Never record
  coordinates.
- A read needs Cadence frontmost: `location.m` returns "inactive" when `NSApp.active`
  is false. A background automation cannot make Cadence frontmost.
- On desktop, the Travel panel's permission line is not a status-only check. It runs a
  full location request, so a check right after a successful read can wait for a new
  fix and log "timeout" after 12 seconds. That is the permission check, not the read
  shown on screen (October 24, PR #140).
- locationd's "not a plugin or an app" (`-10814`) lines and visit-monitoring
  subscriptions are routine; they also appear for Apple's own apps.
- WebKit treats an occluded window as hidden. A window on another Space, behind other
  windows, or under Computer Use's full-screen control overlay logs
  `isViewVisible(): … window occluded 1`. `document.hidden` then blocks location reads
  before the native call, and account sync slows (one **Sync now** took 3 min 23 s on
  October 27). For location checks, release full-screen control, run
  `osascript -e 'tell application id "app.cadence.desktop" to activate'`, and press
  controls through the accessibility tree.

## Release acceptance

From 0.1.5 on, every notarized release must pass the checks below (`docs/DECISIONS.md`,
2026-10-24). Record them in a one-page packet copied from the
[release-packet template](qa/desktop-release-packet-template.md), and link evidence
instead of pasting it. The owner still instructs each notarization and publication.

The test Mac stays on the last published release, so it can run check 3. Dev-signed
builds go only to the owner's Mac. If a candidate is not published, return the test
Mac to the published version from its protected copies.

### Every release

1. **Artifact checks.** `release.mjs check`, then `release.mjs build` from the release
   commit, with all 14 artifact checks passing. CI passed on that commit, and any PR
   that changed `supabase/` passed the Supabase rehearsal. A release does not rerun
   them locally.
2. **Notarization and quarantined download.** Apple accepted the app and the DMG, and
   both staples validate. Gatekeeper accepts a quarantined copy of the DMG and the app
   inside it as Notarized Developer ID, and `syspolicy_check distribution` passes.
   Publication step 6 repeats this on the public URL.
3. **Upgrade from the last published version.** On the test Mac, with Cadence quit,
   save a consistent database copy and a ZIP of the installed app. Install the
   candidate, open it, save a second copy, and compare the two with
   `npm run desktop:release:acceptance` (see "Signing-only upgrade acceptance"; use
   `--same-schema` when the schema is unchanged). No table may lose rows, and every
   change must be classified. Install from a browser download of the DMG, which also
   covers the first open, unless check 4 applies.
4. **Real updater.** When the SQLite schema changes, or the last published version
   changed its updater files, check 3 installs through the real updater: **Install
   update**, then **Restart Cadence**. The schema changes when any file under
   `apps/desktop/src-tauri/migrations/` changes. The updater files are
   `apps/desktop/src/desktop-updater.ts`, `native-updater.ts`,
   `desktop-update-panel.tsx` and `desktop-restart.ts`,
   `apps/desktop/src-tauri/src/updates.rs`, and the updater entries in
   `tauri.conf.json` and `Cargo.toml`. A running app installs an update with its own
   updater code, so the release after an updater change tests that change. Published
   builds read only the stable feed, so this check runs during publication, before the
   download link and the preview feed move ("Publication", step 3).

### Area checks

Run an area check when `git diff --name-only <last published commit> <release commit>`
lists one of its files. Record a skipped check as "Not required: no change to …".
Agents may add a check for a change outside these lists; they never skip a check whose
files changed. Evidence from a dev-signed build or an earlier candidate stays valid
while the check's files are unchanged since that build. A ticket's own installed
acceptance stays with the ticket; the packet links it.

| Check | Files | Pass |
|---|---|---|
| Sign-in callback replay | `apps/desktop/src/account/auth.ts`; `apps/desktop/src-tauri/src/auth.rs`; `apps/desktop/src-tauri/native/auth.m`; the deep-link entries in `tauri.conf.json` and `Cargo.toml` | While signed in, a replayed callback, an expired one and an unexpired pending one each show the account notice. The account stays linked and sync stays current. |
| Session renewal and revoked session | The sign-in files; `apps/desktop/src/account/account-sync.ts`; `apps/desktop/src/sync-engine.ts`; the resolved `@supabase/supabase-js` version in `package-lock.json` | Sync is still current after more than an hour signed in. On the test account, with the owner's authorization, delete its hosted session. After the access token expires, Settings shows the revoked state with Reconnect account. Reconnecting syncs, and no table loses rows. |
| Calendar callback replay | `apps/desktop/src/calendar/google-calendar.ts`, `use-google-calendar.ts`, `outlook-calendar.ts` and `use-connectors.ts` | A replayed Calendar callback leaves the connection unchanged. |
| Native reminders | `apps/desktop/src/local-reminder.service.ts` and `notification-activation.ts`; `apps/desktop/src-tauri/src/notifications.rs`; `apps/desktop/src-tauri/native/notifications.m`; `native-reminder.resolver.ts` in `packages/core` or `lib` | Settings shows verified coverage, and a reminder arrives while Cadence is quit. |

0.1.3, the first production release, also passed the Ticket 115 list in
"Apple-trusted distribution". Later releases do not repeat it.

## Publication

Publish only on the owner's instruction for the exact artifact; `V` is its version.
First save the current `desktop-stable/latest.json` and `desktop-preview/latest.json`
as rollback copies.

1. Upload `Cadence_V_aarch64.dmg`, the updater archive as
   `Cadence_V_aarch64.app.tar.gz` with its `.sig`, and `Cadence_V_verification.json` to
   the `desktop-stable` release. Keep every earlier asset.
2. Replace `desktop-stable/latest.json` with the packet's feed entry.
3. When check 4 applies, update the test Mac now: quit and reopen Cadence, choose
   **Review update**, **Install update** and **Restart Cadence**, and finish check 3's
   comparison. GitHub can serve the previous feed for a few minutes; confirm the
   release notes shown. On failure, restore the saved `latest.json` and stop.
4. Replace the version-free asset `Cadence_aarch64.dmg` with a copy of
   `Cadence_V_aarch64.dmg`. The marketing **Download for Mac** button links to it, so
   publication changes no website source and needs no marketing deployment. Upload the
   copy under a temporary name, delete the old asset, then rename the new one; the link
   is broken only between the last two calls:

   ```bash
   T="$(mktemp -d)"
   cp -p Cadence_V_aarch64.dmg "$T/Cadence_aarch64.next.dmg"
   gh release upload desktop-stable "$T/Cadence_aarch64.next.dmg" --repo emixd12/cadence
   gh api repos/emixd12/cadence/releases/tags/desktop-stable \
     --jq '.assets[] | select(.name | startswith("Cadence_aarch64")) | "\(.id) \(.name) \(.digest)"'
   gh api -X DELETE repos/emixd12/cadence/releases/assets/<old id>
   gh api -X PATCH repos/emixd12/cadence/releases/assets/<new id> -f name=Cadence_aarch64.dmg
   ```

   Avoid `gh release upload --clobber` here: it deletes the old asset before uploading,
   so a failed upload leaves the link broken.
5. Replace `desktop-preview/latest.json` with the same entry.
6. Read back from the public URLs: the SHA-256 of every new asset, including the
   version-free DMG; both feed versions; the feed signature against the downloaded
   archive with the persistent updater key; and check 2 on a quarantined download of
   `https://github.com/emixd12/cadence/releases/download/desktop-stable/Cadence_aarch64.dmg`.
   Repeat until GitHub serves the new bytes.
7. Record the results in the packet and `STATUS.md`.

No public Trust check requests a release asset. Its route and artifact checks fetch
only the named application and marketing deployments, and none of the files they
digest contains the download link. Every merge to `main` still rebuilds marketing and
needs the Trust marketing-ID refresh in `docs/VERCEL_WORKFLOW.md`, so release records
can wait for another merge.

To roll back the download link, copy the previous `Cadence_<version>_aarch64.dmg` to
`Cadence_aarch64.dmg` the same way. To stop further installs, restore the saved feeds;
installed copies have no downgrade path. GitHub's immutable releases are off for this
repository; turning them on would block replacing `latest.json` and the version-free
DMG.

## Local signature fixture

With Minisign installed, run:

```bash
CADENCE_RELEASE_CRYPTO=1 npm exec -- vitest run tests/desktop-release-signature.test.ts
```

This opt-in test uses the same `verify-updater-signature.mjs` function as the
release command. Node creates disposable Ed25519 keys in memory and signs a
synthetic archive in Minisign's current prehashed format. Private keys never
leave memory. Only public keys, signatures, and synthetic archive data reach
temporary files, which the test and verifier remove.

On 2026-08-30, Minisign 0.12 accepted the unchanged archive and rejected changed
archive bytes, a different public key with the same key ID, a corrupted
signature, and an altered trusted comment. The helper also rejected malformed
base64. All six checks passed. Without `CADENCE_RELEASE_CRYPTO=1`, the ordinary
test suite skips this external-tool fixture. An opted-in run fails if Minisign
is missing; it never replaces verification with a mock.

This proves the local release verifier's cryptographic checks. Ticket 113
separately proved Tauri's installed preview update path and data preservation.
Developer ID signing, notarization, and notarized-DMG Gatekeeper acceptance
remain Ticket 115 requirements.

## Apple-trusted distribution (Ticket 115)

Tauri produces `Cadence.app.tar.gz` and its `.sig` beside the app. The updater
feed must use the `darwin-aarch64` platform entry, a newer SemVer version, the
public HTTPS archive URL, and the **contents** of the generated `.sig` file.
Do not substitute the signature filename. Use the
[Tauri updater format](https://v2.tauri.app/plugin/updater/). No feed or key is
invented by this implementation.

Ticket 115 execution is authorized and in progress. Membership became available on
September 27, 2026. The Developer ID identity and matching provisioning profile
are installed. Apple accepted the Keychain-held notarization credentials. Candidate
`0.1.1-rc.3` app and DMG notarization are accepted. Both staples, Gatekeeper, and
strict artifact verification pass. rc.2 passed quarantined download and normal first
launch; rc.3 adds reviewed public service configuration. rc.3 native test-account
sign-in, session persistence, Calendar selection/refresh/disconnection, copied-primary
launch preservation, and closed-app reminder delivery pass. Real updater installation,
notification activation, sleep/wake, and remaining installed lifecycle checks stay open.
Signed location still times out without a permission grant. The primary preview.45
app and data are restored and verified. The owner deferred macOS 14 runtime
acceptance without changing the declared and compiled macOS 14 minimum.
Follow the [September 27 execution plan](plans/2026-09-27-apple-developer-unblocked-work.md).
Ticket 115 required this record before the first production release, 0.1.3. Later
releases follow "Release acceptance" above instead:

- Owner-authorized Apple Developer Program access.
- A valid Developer ID Application certificate and installed signing identity.
- Complete notarization credentials and successful Apple submission.
- Stapled notarization validation for both the app and DMG.
- All repository, desktop, shared-adapter, and interaction release checks.
- Actual WKWebView parity, offline launch, and native reminder evidence.
- Bundled font, image, and audio redistribution rights.
- Successful Gatekeeper launch from a quarantined downloaded notarized DMG.
- Actual execution and acceptance on the current Apple Silicon host. Record the
  exact tested macOS version and build for each candidate. Do not infer macOS 14
  or other untested-version compatibility from the compiled minimum.
- Signature rejection after changing the archive or using a different key.
- User-controlled installation/restart and network-failure recovery.
- Stable profile/database identity, Notes, status/configuration/definition
  history, timing, provenance, outbox/cursors, and notification reconciliation
  after the upgrade.

Both Ticket 113 previews use SQLite schema 6, so live shipped-migration testing
is not applicable to that release. Existing native rollback tests remain current
evidence. Every schema-changing release upgrades the last published version through
the real updater with a protected database backup ("Release acceptance", check 4).
Do not create a disposable migration build or separate migration ticket.

On 2026-08-31, `release.mjs check` loaded the existing public updater endpoint,
canonical public key, persistent private key path, and Keychain-held password.
Updater configuration, tools, and desktop parity passed. The command stopped
only on the missing Developer ID Application identity and complete notarization
credential set. No secret was printed or regenerated. Keep this failure as
Ticket 115 evidence; do not weaken the production checks.

Production publication requires the owner's release instruction. Passing the
local helper does not publish or satisfy Ticket 115.

Signed builds use the stable feed
`https://github.com/emixd12/cadence/releases/download/desktop-stable/latest.json`,
chosen by the owner on October 19, 2026. Supply it as `CADENCE_UPDATER_ENDPOINT`.
Previews keep the `desktop-preview` feed. At publication, that feed also names the
signed release, so preview users can move to it. `0.1.5` is the published stable
release, from October 24, 2026: Behavior Where (SQLite schema 18), the 0.1.4
session fix and the location entitlement. It restores Behavior sync after the
hosted Where migration ([0.1.5 packet](qa/2026-10-23-desktop-0.1.5-release-packet.md)).
`0.1.3` was the first published stable release
([2026-10-21 packet](qa/2026-10-21-desktop-0.1.3-release-packet.md)). `0.1.4` was never
built or published; its fix ships in 0.1.5
([0.1.4 preparation](qa/2026-10-21-desktop-0.1.4-preparation.md)).
Do not publish the superseded `0.1.2`
([2026-10-20 packet](qa/2026-10-20-desktop-0.1.2-release-packet.md)) and `0.1.1`
([2026-10-19 packet](qa/2026-10-19-desktop-0.1.1-release-packet.md)).

Xcode 27.1 `strip` corrupts release proc-macro dylibs built with the macOS 14.0
deployment target, and dyld then refuses to load them. `src-tauri/Cargo.toml` keeps
`[profile.release.build-override] strip = false`; do not remove it while that
toolchain is in use. Clean release builds compile every helper again, so the
failure only shows in a fresh checkout.

The [2026-08-30 asset checklist](qa/2026-08-30-desktop-asset-provenance.md)
records the six image/audio files, hashes, and owner authorization. Bundled
font and Lucide notices are verified separately. The owner's 2026-08-31 statement
now authorizes all six exact files inside Cadence; that authorization does not
change MIT exclusions, trademark rights, or third-party notices.

## Pending day-progress/Calendar release (Tickets 133–137)

Do not publish this working tree as an accepted Calendar release. Local checks
and fresh review pass. The owner approved provider setup, hosted rollout, live
consent, installed desktop acceptance, and similar task actions on 2026-09-17.
Preview.40 is installed with a protected database backup and preview.39 rollback
app. Its 11 artifact checks pass; its signature remains ad hoc.
Protect the installed database before native acceptance. Verify real consent,
wrong-account refusal, offline cache after restart, revocation/cleanup, source
links, day rollover, minimized work, and upgrade preservation. Evidence belongs
in `docs/qa/day-progress-release.md`. Existing Ticket 115 Apple-trust gates remain.
