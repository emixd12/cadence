# 05. Mac App Store listing

Part of the running iOS blueprint. The hub is `docs/IOS_PLAN.md`. This file is
not a source-of-truth document and authorizes nothing. No Mac App Store build,
target, entitlement change, ticket or ticket number exists. Mobile and Mac App
Store work stay out of scope in `AGENTS.md` until the owner activates the track
(`docs/DECISIONS.md`, 2026-11-18 and 2026-11-25).

Step IDs such as `IOS-MAS-1` are plan-local. They are not ticket numbers. Real
ticket numbers are allocated at activation.

Baseline: the October 15, 2026 proposal and Part A, A.9 (`docs/IOS_PLAN.md` at
`64b78b80`), `docs/DESKTOP_RELEASE.md`, `docs/LEGAL.md` (L-024, L-025), and the
owner decisions of November 18 and November 25, 2026 (D30.5; "Modular iOS
blueprint", item 7).

## 1. Owner decision: two distribution channels

Decided November 25, 2026. Cadence for Mac keeps both channels.

| Channel | Role | Updates | Audience |
|---|---|---|---|
| Mac App Store | Primary install. The marketing site (`cadence-me.com`) highlights it | The Mac App Store | Most Mac users |
| Notarized direct download | Stays available. `Cadence_aarch64.dmg` on the public `desktop-stable` GitHub release | Built-in Tauri updater, `desktop-stable/latest.json` | Open-source and power users |

Both channels ship from one codebase and one version number. The Mac App Store
build is a build variant, not a fork.

Changing the marketing **Download for Mac** button to a Mac App Store badge is
public copy. It runs through the messaging track (`docs/MESSAGING_CHANGES.md`)
at activation, not inside a development step.

## 2. Current Mac facts the variant starts from

Read from the repository on November 25, 2026. Recheck at activation.

| Fact | Value | Source |
|---|---|---|
| Bundle identifier | `app.cadence.desktop` | `apps/desktop/src-tauri/tauri.conf.json` |
| Version in source | `0.1.17`, published November 26, 2026 (schema 28, contract 9) | `tauri.conf.json`; `STATUS.md` |
| Minimum macOS | 14.0 declared and compiled; macOS 14 runtime untested (owner-deferred) | `tauri.conf.json`; `AGENTS.md` |
| Architecture | Apple silicon only (`aarch64`) | `docs/DESKTOP_RELEASE.md` |
| Team ID | `HK26VT477G` | `apps/desktop/src-tauri/Entitlements.plist` |
| Entitlements today | `application-identifier`, `team-identifier`, `keychain-access-groups` (`HK26VT477G.app.cadence.desktop`), `personal-information.location`. No App Sandbox | `Entitlements.plist` |
| Signing | Developer ID Application identity, expires December 11, 2027; Developer ID provisioning profile | `docs/DESKTOP_RELEASE.md`, "Signing credentials" |
| Notarization | App Store Connect API key (D29.4) | Same |
| Updater | `tauri-plugin-updater` `=2.14.1`, registered in `lib.rs` only when `updates::is_configured`; key `updater-2026-11` | `apps/desktop/src-tauri/src/lib.rs`, `updates.rs`; `docs/DESKTOP_RELEASE.md` |
| Updater UI | `desktop-updater.ts`, `native-updater.ts`, `desktop-update-panel.tsx`, Settings "Check for updates" and automatic download; intent `INT-DESKTOP-002` | `apps/desktop/src/` |
| Deep links | `tauri-plugin-deep-link` (`cadence://`) | `lib.rs` |
| Subprocess | `recovery.rs` runs `/bin/df -Pk` to read free space (`available_bytes`); only databases older than schema 14 reach it | `apps/desktop/src-tauri/src/local_store/recovery.rs:242` |
| File dialogs | Native save, backup and restore dialogs | `apps/desktop/src-tauri/src/files.rs` |
| Data location | `app_data_dir()`: `cadence.sqlite3`, `calendar-cache.sqlite3`, the old spike database | `lib.rs` |
| Sign-in | Google, email and Apple through the hosted web flow (Ticket 336, Mac 0.1.11, November 14, 2026). Not native `ASAuthorizationAppleIDProvider` | `STATUS.md`; D31 |
| ChatGPT plan | Mac connects one ChatGPT account; tokens in Keychain (D27, Tickets 294–300) | `AGENTS.md` |
| Google Calendar for AI | `purpose=ai_mcp` broker through the hosted web flow and `cadence://` (0.1.17). Its pending connect state moves to Keychain in PR #432, merged after 0.1.17 and not yet released. Recheck under the sandbox's Keychain group | `STATUS.md`; PR #398, PR #432 |

## 3. Build variant (`IOS-MAS-1`)

### 3.1 Channel switch

- Add a build-time channel, `direct` or `mas`, chosen by the release script.
  The default stays `direct`.
- `mas` builds compile without `tauri-plugin-updater`, through a Cargo feature,
  not only a runtime check. App Review guideline 2.4.5(vii) requires Mac App
  Store updates and forbids other update mechanisms. A dormant updater crate in
  the binary invites a rejection. Recheck the guideline text at activation.
- `mas` builds hide every updater surface: "Check for updates", automatic
  download, Review update, Install update, Restart Cadence, and the update
  panel. Settings shows "Updates come from the Mac App Store".
- Registry: `INT-DESKTOP-002` gains a channel condition. It applies to the
  direct channel and is not applicable to the Mac App Store channel. The
  registry change lands with the step that changes the UI.
- `direct` builds keep the updater, the feed, the key and the release steps in
  `docs/DESKTOP_RELEASE.md` unchanged.

### 3.2 App Sandbox entitlement audit

The Mac App Store requires `com.apple.security.app-sandbox` (guideline
2.4.5(i)). The direct build stays unsandboxed unless a later decision changes
that.

| Entitlement or area | Need | Notes |
|---|---|---|
| `com.apple.security.app-sandbox` | Required | `mas` only |
| `com.apple.security.network.client` | Required | Supabase, hosted APIs, OpenAI through Cadence's server, Geoapify, ChatGPT plan calls |
| `com.apple.security.network.server` | Check | Needed only if any sign-in or ChatGPT callback listens on a loopback port. Deep links (`cadence://`) need no server entitlement |
| `com.apple.security.files.user-selected.read-write` | Required | Export, Import, raw database backup and restore through the native dialogs in `files.rs` |
| `com.apple.security.personal-information.location` | Required | Already present. Travel and completion place labels, When In Use only |
| `keychain-access-groups` | Required | Session secrets and ChatGPT tokens stay in Keychain. Confirm the group string the Mac App Store profile authorizes |
| Notifications | No entitlement | Native reminders and leave reminders. Verify scheduling and readback in the sandbox |
| `com.apple.security.files.downloads.read-write` | Avoid | User-selected access covers Export |
| Temporary exceptions | Avoid | App Review asks for justification; none is expected |

Code and behavior changes the sandbox forces:

- **`/bin/df` in `recovery.rs`.** Replace the subprocess with a direct
  free-space call (`statfs` or `NSURL` volume resource values), in both
  channels so the code stays single. Whether the sandbox would permit the
  subprocess is not verified; removing it is simpler than proving it. The same
  change is iOS prerequisite `IOS-190d` (iOS forbids subprocesses). If
  `statfs` is used, check whether a required-reason declaration applies on
  macOS (Section 5.3).
- **Out-of-container paths.** Inside the sandbox, `app_data_dir()` resolves
  inside `~/Library/Containers/<bundle id>/Data/`. Audit every path the app
  builds by hand, including identity adoption (`adoption.rs`), the old spike
  database, recovery markers, export temp files and logs.
- **Moving existing data into the container.** A person who switches from the
  direct build to the store build has data outside the container. Options,
  decided in `IOS-MAS-1`: Apple's container migration manifest (moves listed
  files into the container on first sandboxed launch; documented for
  sandbox adoption, not verified for Tauri), a signed-in resync from the hosted
  account, or BehaviorLog export and import. Local-only accounts need the
  first or the third.
- **Security-scoped bookmarks.** Needed only if Cadence must reopen a
  user-picked file later. Export, Import and backup are one-shot today, so none
  is expected.
- **Hardened runtime** stays on in both channels.

### 3.3 Identity and coexistence

Decided November 25, 2026 (`docs/DECISIONS.md`):

- **One shared Mac bundle identifier (`app.cadence.desktop`).** Both the Mac App
  Store build and the direct GitHub DMG build use `app.cadence.desktop`. macOS
  treats them as the same app: one Keychain access group, one notification
  identity, one `cadence://` deep-link handler, one Launch Services entry, and
  no duplicate side-by-side installs (installing the store copy replaces the
  direct copy).
- **Separate iPhone and Mac App Store listings (no Universal Purchase).**
  iPhone and Apple Watch use `app.cadence.ios` (plus its extension/watch
  sub-IDs) and Mac uses `app.cadence.desktop` on its own App Store Connect
  record. Because Mac (Tauri) and iPhone (native SwiftUI) are separate
  codebases, separate listings keep ratings and reviews scoped per platform so
  reviews stay relevant to the device people are shopping for. Separate records
  maintain their own privacy labels, age ratings and metadata; confirm at
  activation how Apple handles matching titles/subtitles across two separate
  records under one developer account.
- **Team ID.** If the organization upgrade (`06-app-store-readiness.md`, item 1)
  changes `HK26VT477G`, both channels' Keychain groups and the Developer ID
  identity change. Settle the membership first.

## 4. Sign-in, accounts and compliance (`IOS-MAS-2`)

### 4.1 Guideline 4.8 (Login Services)

- The Mac offers Google sign-in, so 4.8 binds the store build
  (`docs/LEGAL.md`, L-024). Sign in with Apple is already offered through the
  hosted web flow since Mac 0.1.11 (D31, Ticket 336).
- Open question for activation: whether App Review accepts the browser-based
  Apple flow in a Mac App Store app, or expects native
  `ASAuthorizationAppleIDProvider`. L-024 records the expectation that the store
  build needs native Sign in with Apple. Reread 4.8 and L-024 at activation.
- If native is needed, reuse the iPhone server path from `IOS-203`: hashed nonce
  to Apple, raw nonce to Supabase `signInWithIdToken`, the Sign in with Apple
  capability on the App ID. Native Sign in with Apple is out of scope in
  `AGENTS.md` and D31 today; activation amends that line.
- The Apple action must be at least as prominent as Google's and visible
  without scrolling. L-024's November 14 update records that the owner styled
  Continue with Apple like the other text actions, which departs from Apple's
  custom-button rules. Recheck before review.
- PLA 3.3.5(C): the same product title everywhere Sign in with Apple appears
  (`06-app-store-readiness.md`, item 2).

### 4.2 Guideline 5.1.1(v) (account deletion)

- The store build must let a person delete the account in the app. The Mac
  needs deletion parity with web Settings: re-authentication, a typed
  confirmation, hosted deletion, Apple token revocation (L-025), Sequenzy
  subscriber deletion, and a retention notice.
- The Mac needs a terminal "account deleted" state. Today it retries a generic
  failure when the hosted account is gone (B 5.6). The same work serves iPhone
  deletion while a Mac is linked (`IOS-190f`, scenario 17 in
  `07-build-phases.md`).
- After deletion the person chooses to keep the local working copy or remove
  it. Removal clears the SQLite files, Keychain items and pending
  notifications.

### 4.3 Privacy, AI consent and age

- **Privacy manifest.** Ship a `PrivacyInfo.xcprivacy` in the store build.
  Not verified: whether App Store Connect enforces required-reason API
  declarations for macOS uploads as it does for iOS. Declare anyway: SQLite
  `stat`/`fstat` (`C617.1`), user defaults (`CA92.1`), file timestamps
  (`3B52.1` for user-picked files), and `statfs` if Section 3.2 uses it.
- **App Privacy label.** A separate Mac record needs its own label. Match the
  iPhone label in `06-app-store-readiness.md`, item 5.
- **AI consent (5.1.2(i)).** The store build shows the same unified AI approval
  as web (`Settings → AI features`, `components/onboarding/AiFeaturesApproval.tsx`),
  naming OpenAI, the data sent, retention, revocability, the AI-generated label
  and "not medical advice" (`06-app-store-readiness.md`, item 4). The ChatGPT
  plan connection (D27) needs one review-notes paragraph: it runs on the
  person's own plan and Cadence sells nothing.
- **Age rating.** 18+ override, matching the iPhone app. Age-signal gating
  applies where the platform provides signals; recheck macOS availability of
  the iOS 26.2 and 26.4 age APIs at activation.
- **Category.** Productivity, matching the iPhone app.

### 4.4 iPhone app on the Mac

One native Mac app covers the Mac. On the iPhone app record:

- Turn off "iPhone and iPad Apps on Apple Silicon Macs" availability in App
  Store Connect (B 3.1).
- Turn off iPhone widgets on the Mac desktop. WidgetKit offers a disfavored
  location for iPhone widgets on Mac (decided November 25, 2026; mechanism to
  confirm in `IOS-198`).
- Turn off visionOS availability (B 3.1).

## 5. Signing and release pipeline (`IOS-MAS-2`)

### 5.1 Credentials

The store channel adds credentials. It changes none of the direct channel's.

| Credential | Purpose | Owner step |
|---|---|---|
| Apple Distribution certificate (Mac App Distribution) | Signs the app for the store | Request in the portal or through the App Store Connect API; owner approves two-factor |
| Mac Installer Distribution certificate | Signs the `.pkg` for upload | Same |
| Mac App Store provisioning profile for the bundle identifier | Authorizes sandbox, Keychain group, location and Sign in with Apple; embedded as `Contents/embedded.provisionprofile` | Same |
| App Store Connect API key | Upload and build status. The D29.4 key exists for notarization; check its role covers uploads, or create a second key | Owner creates keys |

Add each to `apps/desktop/release-credentials.json` and back it up with
`npm run release:credentials -- backup` under its own vault item, as
`docs/DESKTOP_RELEASE.md`, "Signing credentials", does for the Developer ID
set. Keys never enter git or an agent prompt.

### 5.2 Pipeline

1. One release version `V` for both channels. The store build number
   (`CFBundleVersion`) increases on every upload.
2. `direct`: the existing flow. Developer ID signing, notarization, staple, DMG,
   updater archive and signature, `desktop-stable` publication. Unchanged.
3. `mas`: build with the `mas` channel and the sandbox entitlements, sign with
   Apple Distribution, embed the profile, wrap with `productbuild` and the
   installer certificate, validate, upload with the API key. Tauri's App Store
   distribution guide describes this route; recheck it at activation. Confirm
   which upload tool Apple still supports (Transporter, `altool`, or the App
   Store Connect build upload API).
4. Release checks gain a channel guard: the `mas` binary contains no updater
   symbols or feed URL; the `direct` binary keeps them; each build's
   entitlements match its profile (`release:credentials status` extended).
5. Mac TestFlight before every store submission. Internal testers first;
   external testing needs Beta App Review for a version's first build.
6. Submission, review and release on the owner's instruction for each
   version, as Apple notarization and publication already require
   (`AGENTS.md`, "Agent operating model").
7. A direct-channel publication never waits on store review. Store review of
   version `V` may trail the direct release of `V`.

## 6. Unknowns to verify when the track starts

Each is unverified on November 25, 2026.

1. Guideline 2.4.5 text, in particular (i) sandbox and (vii) updates.
2. Whether 4.8 accepts the hosted Apple flow on Mac or needs native (Section 4.1).
3. Whether macOS store uploads enforce required-reason declarations.
4. Whether macOS exposes the iOS 26.2/26.4 age-assurance APIs.
5. Tauri v2 App Store guide: current steps, `productbuild` flags, profile embedding.
6. Whether any sign-in or ChatGPT callback needs `network.server`.
7. Container migration for existing direct-download data (Section 3.2).
8. Whether Apple permits the exact same App Store title on two separate records (iPhone `app.cadence.ios` and Mac `app.cadence.desktop`) under one organization account, or requires slight title differentiation (Section 3.3).
9. Whether the team ID survives the organization upgrade.
10. Whether an arm64-only store build is offered only to Apple silicon Macs.
11. Whether WKWebView behavior, notifications and location prompts differ inside the sandbox.
12. macOS 14 runtime: the store lists the declared minimum; the owner deferred testing it.

## 7. Acceptance checklist (`IOS-MAS-3`)

Run on a clean Mac account, from a Mac TestFlight install, then from the
released store build.

- [ ] Install from TestFlight on a Mac user with no Cadence data. First launch
      shows no Gatekeeper warning.
- [ ] Sandboxed SQLite: create Behaviors, mark Completed and Not Completed, add
      Notes, run a timer; quit and relaunch; data persists inside the container.
- [ ] Keychain: sign in with Google, email and Apple; quit and relaunch; the
      session survives; sign-out clears it.
- [ ] Location: When In Use prompt appears once; Travel and completion place
      labels work.
- [ ] Export (all five formats), BehaviorLog import and restore, and raw
      database backup and restore through the native dialogs.
- [ ] Sync with web and a direct-download Mac on the same account converges.
- [ ] Native reminders schedule, fire and read back; coverage shows in Settings.
- [ ] No updater surface appears. No request goes to `desktop-stable/latest.json`.
- [ ] The binary contains no updater crate symbols.
- [ ] Account deletion in the app reaches the terminal state on a linked direct Mac.
- [ ] AI approval sheet names OpenAI and shows "not medical advice" before the
      first Daily Brief.
- [ ] Moving from the direct build to the store build keeps the person's data by
      the method chosen in Section 3.2.
- [ ] The direct DMG still installs, updates through the Tauri updater and
      shows its update UI (scenario 23 in `07-build-phases.md`).
- [ ] Evidence uses PASS, FAIL, UNVERIFIED, N/A, as in `07-build-phases.md`.

## 8. Steps

| Step | Contents | Depends on | Size |
|---|---|---|---|
| `IOS-MAS-1` | Channel switch; updater removal from `mas`; sandbox entitlements; `/bin/df` replacement; container path audit and data move (shared `app.cadence.desktop` ID) | Organization membership settled | M |
| `IOS-MAS-2` | 4.8 and 5.1.1(v) parity, terminal account-deleted state, privacy manifest and label, 18+ rating, AI consent check, credentials, dual-channel release pipeline | `IOS-MAS-1`; deletion API from `IOS-190f` | M |
| `IOS-MAS-3` | Mac TestFlight, Section 7 acceptance, App Review, store release, marketing badge through the messaging track | `IOS-MAS-2`; store title from `06-app-store-readiness.md` | M (L with repeated reviews) |

The track can run beside M4 and M5 of the iPhone plan, or right after the
iPhone v1.0 launch (`07-build-phases.md`).
