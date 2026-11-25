# 04. Accounts, offline storage and technical architecture

Part of the running iOS blueprint. The hub is `docs/IOS_PLAN.md`. This file is
not a source-of-truth document and authorizes nothing. No iOS code, target,
crate, package, ticket or ticket number exists. Mobile work stays out of scope in
`AGENTS.md` until the owner activates the track (`docs/DECISIONS.md`,
2026-11-18 and 2026-11-25).

Step IDs such as `IOS-189a` are plan-local. They are not ticket numbers. Real
ticket numbers are allocated at activation.

Baseline: the October 15, 2026 proposal (`docs/IOS_PLAN.md` at `64b78b80`,
Part B, Sections 0, 2.1, 4.1–4.9, 5.6, 6, 8 and 9), with the owner decisions of
November 18 and November 25, 2026. Code facts below were rechecked on
`64b78b80` where marked.

## 1. Owner decisions

| Date | Decision | Effect here |
|---|---|---|
| 2026-11-18 | The first iOS release has accounts: sign-in and sync | Sync is on the v1.0 critical path. Part B's local-only v1.0 and its milestone order are superseded |
| 2026-11-18 | Evaluate CloudKit and SwiftData against the SQLite store and Supabase sync, at activation | Section 10 |
| 2026-11-25 | v1.0 requires sign-in on first launch. No anonymous local-only mode before sign-in | No first-link local merge on iOS. Closes `docs/IOS_PLAN.md` A.6 row 19 |
| 2026-11-25 | Full local offline support once signed in, matching a linked Mac | Section 2 |

Requiring sign-in first removes one sync case the Mac must handle: linking an
existing local-only working copy to an account (the first-link replacement plan
in `packages/core/src/resolvers/account-sync.resolver.ts`). Every iPhone working
copy starts from the hosted account.

## 2. Offline and online-only features

### 2.1 Works offline once signed in

All non-AI tracking works immediately offline. Writes persist to the local store
and an outbox, and sync when connectivity returns.

- Viewing Timeline, Behaviors, Analytics, Routines and the Opportunity Basket.
- Marking Completed and Not Completed, and changing a resolved status.
- Adding and editing auto-saved Notes, including deterministic Note shortcuts.
- Starting and stopping timers.
- Creating, editing, pausing and ending Behaviors; Categories.
- Local reminders: planning, scheduling, readback and coverage.
- Local Export and BehaviorLog Import, in the portability engine.

### 2.2 Online-only, with an offline state

Each shows a plain offline state. None blocks tracking.

| Feature | Offline state |
|---|---|
| Daily Brief, Coach tips and proposals, Chat, AI note patterns, Alongside and Where model guesses | "Needs a connection." Last delivered content stays visible where the web shows it |
| Hosted connectors: Google, Outlook and iCloud Calendar; Hevy live refresh | Last fetched context shown with its age. No refresh |
| Geoapify remote place search | Falls back to saved places, matched locally and instantly, plus free text |
| Live Travel route lookups | Shows the last estimate with an offline note |

Connector completion (D28) runs in the hosted job. The iPhone receives its
results through sync and shows the label.

## 3. Sign-in

Sign-in methods match D31 and satisfy App Store guideline 4.8. Every method
reaches the same account. No passwords.

### 3.1 Sign in with Apple (native)

- `ASAuthorizationAppleIDProvider`. Send a SHA-256 hashed nonce to Apple. Send
  the raw nonce with the identity token to Supabase `signInWithIdToken`.
- The Apple button is at least as prominent as Google's and visible without
  scrolling.
- Check the Apple credential state when the app comes to the foreground.
  Observe the credential revocation notification and sign out locally on
  revocation.
- Apple returns the name only on first authorization. Store it then.
- Hide My Email accounts do not auto-link to a Google account. If sign-in
  returns a minutes-old account with no data, offer "I use Google instead"
  before the person adds anything.
- Native Sign in with Apple is out of scope in D31 today. It needs a decision
  and a ticket at activation.

### 3.2 Google

- Supabase OAuth with PKCE in `ASWebAuthenticationSession`.
- `Callback.https` with an associated domain. Needs `apple-app-site-association`
  on the web domain. Apple's CDN can take up to 24 hours to fetch changes.

### 3.3 Email code

- A native email field and a 6-digit code screen, matching web and Mac (D31). No
  password and no magic-link-only path on iOS, because the code works without
  leaving the app.
- Compatible with the hosted Turnstile check and rate limits. Not verified how
  Turnstile runs in a native flow; settle at activation.
- Reminder and code email to Apple Private Email Relay addresses needs a
  registered sender with SPF and DKIM alignment.
- The control that sends a new code reads "Send again".

### 3.4 Settings → Sign-in methods

- Lists methods, links a method, and unlinks one. An account keeps at least one
  method (D31).
- Connecting Google Calendar adds that Google account as a sign-in method (D31).
  `same_account_required` is still in code; review whether D31 removes the gap
  for Apple sign-in users before iOS Calendar ships.
- A sign-in never reaches an existing account through an unconfirmed email
  address (D31).

### 3.5 Session secrets

- Supabase refresh and access tokens live in Keychain, never in SQLite, App
  Group files, logs, exports or backups.
- The tracking engine never sees the refresh token. Swift injects the access
  token through `HttpPort`.
- No service-role key and no provider credential ships in the app.

## 4. In-app account deletion (guideline 5.1.1(v), v1.0)

Mandatory at the first submission, because v1.0 creates accounts.

Flow:

1. Settings → Account → Delete account.
2. Re-authentication with a current method. Then the person types `DELETE`.
   Email confirmation is not used: relay addresses make it unreliable.
3. Optional reminder to export first.
4. Hosted deletion API with bearer authentication.
5. Apple token revocation with a fresh authorization code. The hosted side
   handles Sign in with Apple server notifications.
   `lib/services/apple-sign-in.service.ts` and migration
   `20261113200000_apple_sign_in_forget_token.sql` exist; review them against
   this flow.
6. Sequenzy subscriber deletion.
7. Retention notice: 7-day backups, OpenAI retention, other linked devices.
8. Complete local wipe:
   - SQLite database, WAL and SHM;
   - App Group read models (`ReadModels/v1/`);
   - Spotlight index;
   - pending and delivered notifications;
   - Live Activities;
   - watch cache (a wipe message to the watch);
   - Keychain items, including the install UUID slot.

Linked desktop: Cadence for Mac needs a terminal "account deleted" state. Today
it retries a generic failure. This is a desktop follow-up.

App Review: a reviewer who signs in with Apple sees an empty account. The review
notes explain how to add sample data.

## 5. Runtime options and measurements

### 5.1 Options

| Option | Rules | UI | Heavy work | Verdict |
|---|---|---|---|---|
| A. Tauri iOS | TS in WKWebView (JIT) | Shared React DOM | Fast | Background writes still need an in-process engine; web-feel UI |
| A-hybrid. Tauri UI + JSContext for background | TS | Shared React DOM | Fast | Maximum-reuse alternative; weaker native quality |
| B. React Native/Expo | TS in Hermes (no JIT) | React Native | Slow; Hermes `Intl` gaps | Rejected |
| **C. SwiftUI + JSContext engines + Rust store** | TS | SwiftUI | Portability slow but bounded; sync needs a separate path | **Recommended**, gated by `IOS-189` |
| D. Full Swift port | Swift | SwiftUI | Swift | Rejected; duplicates ~30k lines |
| D-lite. Swift port of the tracking slice (~3–4k lines) | Mixed | SwiftUI | TS | Fallback if device budgets fail; needs an `AGENTS.md` policy change |

Widgets, Live Activities, notification actions and the watch cannot run a web
view. Rules carry over; screens do not.

### 5.2 M5 measurements

Apple M5 Mac, system `jsc`, `--useJIT=false --useRegExpJIT=false` for no-JIT,
reproduced 2026-10-15. These are not iPhone numbers. Assume an iPhone 11 runs
2–3× slower (inference from single-core benchmark ratios). Remeasure on an
iPhone at activation.

| Workload | JIT | No JIT |
|---|---|---|
| Load tracking bundle (192 KB minified) | — | 9–12 ms |
| Load full core (689 KB minified) | — | 13–16 ms |
| Tracking: 20 Behaviors, 37 days, full regeneration | 38–72 ms | 370–387 ms |
| Same, Temporal polyfill on native BigInt | — | 168–204 ms (identical output hash) |
| Sync planner, 4,521 entities | 0.98 s | 10.0 s |
| Sync planner, 18,021 entities (about a year at 20 Behaviors) | 3.7 s | 40.9 s |
| Export, five-year fixture (24.6 MB) | 1.2 s | 15.3 s |
| Import preview, same fixture | 0.44 s | 7.9 s |
| SHA-256 in JS, per MiB | 13 ms | 244 ms |

Readings:

- Tracking fits without JIT once the Temporal polyfill uses native BigInt.
- Portability is slow but bounded; it runs in its own VM with progress.
- The snapshot sync planner does not fit. Sync needs its own path (Section 11).
- React Native (Hermes, also no JIT) is not an escape.

## 6. Topology

```text
iPhone app process (only writer of cadence.sqlite3)
  SwiftUI screens
  EngineHost       serial executor, VM 1   JSContext: CadenceEngine.js tracking scope
  PortabilityHost  own thread, VM 2        JSContext: same bundle, export/import
  StoreGateway     Rust cadence-local-store (C ABI, JSON) -> cadence.sqlite3
  SyncCoordinator  from packages/local-runtime; foreground only (Section 11)
  Adapters         notifications, Keychain, URLSession, WatchConnectivity, ActivityKit
  ReadModelWriter  atomic JSON in App Group ReadModels/v1/
Widget extension (read-only): widgets, Live Activity UI, Controls UI
watchOS app + watch widgets (v1.1): cache and command queue
Hosted: Supabase, Next.js APIs
```

- One bundle built from `packages/core` and the extracted
  `packages/local-runtime` loads in both VMs.
- Every store write passes through `StoreGateway`.
- One `JSVirtualMachine` serializes its contexts, so long work runs in VM 2.
- The dedicated serial executor keeps 100–400 ms calls off the shared thread
  pool. If deep recursion raises `RangeError`, run the VM on a thread with a
  larger stack (unverified).
- Extensions and the watch run no engine. They render read models and route
  writes to the app process.

### 6.1 Tracking engine scope and host ports

- Scope: statuses, Notes, timing, generation and replanning, reminder planning
  and coverage, read models, analytics, Behavior and category writes, timezone
  changes, outbox writes.
- Before device measurement: Temporal polyfill on native BigInt, native SHA-256
  through a host function, and code-point comparisons in core.
  `docs/IOS_PLAN.md` A.4 counted 83 `localeCompare`/`toLocaleLowerCase` uses in
  `packages/core/src` on November 18 (66 in October).
- Host ports: `StorePort`, `NotifierPort`, `HttpPort`, `SecretPort`,
  `ClockPort`, `CryptoPort`, `LogPort`, `FilePort`, and a display-format port.
- Globals to provide (measured inventory): `crypto.randomUUID` (21 uses),
  `crypto.subtle.digest`, `atob`/`btoa`, `TextEncoder`/`TextDecoder`, `URL`,
  `AbortController`, `fetch`, timers.
- Move `parseBehaviorFormData` validation (`lib/services/behavior-form.ts`) into
  core as typed validation.
- Memory: `JSGarbageCollect` after large operations; reject oversized inputs
  before parsing.

## 7. Persistence and entry points

### 7.1 Store

- Extract `local_store` into `crates/cadence-local-store`. A scratch extraction
  that removed only `tauri::State` passed `cargo check` and 88 tests on the host
  in October. iOS cross-compilation is unverified.
- Move into the crate's request set: account metadata and sync-completion
  transactions (`src-tauri/src/auth.rs`), plus disconnect and backup
  (`files.rs`). First-link moves too, for the Mac; iOS does not use it
  (Section 1).
- `recovery.rs` spawns `/bin/df`; iOS forbids subprocesses. Gate it (only
  databases older than schema 14 reach it). Wrap the FFI in `catch_unwind`.
- FFI: `open`, `invoke(json) -> json`, `close`, `free`. Static XCFramework for
  iOS device, iOS simulator and macOS (host-side Swift tests). Release profile
  `debug = "line-tables-only"`, `strip = false`; upload symbols and keep every
  archive.
- One schema and migration chain for desktop and iOS. On `64b78b80` the desktop
  SQLite chain ends at `0028_sub_behaviors.sql` (schema 28), and
  `ACCOUNT_SYNC_CONTRACT = 9` (`account-sync.resolver.ts:25`). CI compares
  migration hashes.

### 7.2 `0xDEAD10CC` protection

- Apple terminates an app that holds file or SQLite locks during suspension.
- The database lives in app-private Application Support, never in the App Group.
- Every write runs inside `beginBackgroundTask`.
- File protection `completeUntilFirstUserAuthentication` for the database, WAL,
  SHM and read models.
- Exclude read models and export temp files from backup.

### 7.3 Background entry points

Minimum iOS 27.0.

| Entry point | Process | Mechanism |
|---|---|---|
| In-app controls | App | Engine call |
| Notification action | App, background launch | Delegate assigned in a `UIApplicationDelegateAdaptor` before launch finishes |
| Widget button | App | Intent in the shared package with `allowedExecutionTargets = .main` |
| Live Activity button | App | `LiveActivityIntent` |
| Control (Control Center, Lock Screen, Action button, Apple Watch) | App | `.main` target; `authenticationPolicy` chosen per intent |
| Siri, Shortcuts, Spotlight | App | Shared-package intent, `supportedModes` |
| Watch app action (v1.1) | iPhone app | `sendMessage` or queued `transferUserInfo` |
| Background refresh | App | `BGAppRefreshTask`, reminder top-up only; never sync |

Rules:

- Background launches create no scenes. Create the engine, activate
  `WCSession`, set the notification delegate and register background tasks in
  the app delegate, never in `onAppear`.
- Before first unlock after a reboot, protected data is unavailable. Entry
  points report failure and never claim success. No API redelivers a
  notification response.
- Migrations run only in the foreground. A background launch with a pending
  migration rejects the command visibly.
- A database newer than the app (a TestFlight downgrade) enters "Update
  Cadence" mode: fail closed, with no reset, no read-model writes and no
  background writes.
- Restore detection: an install UUID in SQLite and in a `ThisDeviceOnly`
  Keychain item. A mismatch means a restore to another device: regenerate read
  models, reschedule reminders and require sign-in before surface writes. Treat
  `errSecInteractionNotAllowed` as unavailable, never absent. Clear stale
  Keychain slots on a fresh install only after first unlock.
- Map `SQLITE_FULL` to a visible failure at every entry point.

## 8. Command contract

Writes from notifications, widgets, Live Activities, Controls, Siri and the watch
carry:

```ts
{ commandId, capturedAt, expectedStatus, expectedLatestEventId, expectedSessionId?, expectedNote? }
```

- The store returns a prior result for a known `commandId` before planning.
  Domain outbox rows are retained for this. Lost replies cannot double-apply.
- Same status already current: success. Different status current: reject with
  "Already marked elsewhere".
- `recorded_at = max(now, latest.recorded_at + 1 µs)`. Completion and timing
  instants use `capturedAt`, clamped between the read model's `generatedAt` and
  now. This absorbs watch clock skew of about ±2 minutes.
- Timer stop names its session (`expectedSessionId`).
- Note writes carry `expectedNote`. A notification "Add Note" rejects if a Note
  exists and opens the Occurrence. Note text from the Lock Screen requires
  authentication.

Current code (`64b78b80`):

- `packages/core/src/services/occurrence.service.ts` accepts `expectedStatus`
  and `expectedLatestEventId` (A.4, November 18).
- `expectedNote` exists for Occurrence and day Notes
  (`packages/core/src/data-store.ts:111-125`,
  `packages/core/src/resolvers/day-note.resolver.ts`).
- `commandId` replay was not found. It is a cross-platform prerequisite.

## 9. Read models

- `timeline.json`, `widget.json` and `watch.json`, written atomically. Each
  carries `generatedAt`, `validUntil`, `schemaVersion`, `databaseRevision`, the
  profile timezone, and several upcoming local midnights with precomputed
  groupings.
- Each actionable row carries its expected status, latest event ID, and the
  engine-computed result of each action (status, tone, group). Swift shows that
  result immediately and never decides a status rule.
- Times are structured values. Swift formats them with `Date.FormatStyle` in the
  Behavior timezone, honoring the person's 12/24-hour and region settings. The
  engine formats notification text through a host-supplied formatter, so
  coverage readback compares exact strings. Core's `formatClockTimeLabel`
  (`packages/core/src/services/schedule.ts`) hard-codes 12-hour English output.
- After each commit: write read models, then debounce `WidgetCenter` reloads,
  `ControlCenter.shared.reloadControls(ofKind:)`, Live Activity updates and the
  watch context. Reload once more when the app moves to the background.
- A sync apply is a commit like any other: it rewrites read models once, after
  the local transaction.

## 10. Evaluation gate: Apple-provided storage

Owner decision, November 18, 2026: evaluate CloudKit and SwiftData at
activation, inside `IOS-189`.

### 10.1 Candidates

| Layer | Baseline | Apple candidate |
|---|---|---|
| Local store | Rust `crates/cadence-local-store` over SQLite (desktop schema 28, sync contract 9) | SwiftData |
| Sync | Supabase sync with the shared planner | CloudKit |

### 10.2 Known constraints going in

- CloudKit cannot serve web or other non-Apple users. Primary tracking data
  must reach the web app, so CloudKit would be a second sync backend beside
  Supabase. That is unacceptable for primary tracking data. CloudKit is
  acceptable only for Apple-only auxiliary state, if any such state exists.
- SwiftData could serve as a native local store or cache. The comparison
  weighs:
  - schema parity with the desktop SQLite chain, which the Mac and iOS would
    otherwise share;
  - SQLite migration and migration-checksum guarantees, which CI checks today;
  - zero rule duplication: domain rules stay in TypeScript, so SwiftData must
    not need Swift copies of status, recurrence or reminder rules;
  - atomic mutation plus outbox writes in one transaction;
  - access from the JSContext engine through `StorePort`;
  - background-launch safety under `0xDEAD10CC`.

### 10.3 Exit

Record the result in `docs/DECISIONS.md` at activation. The baseline stays
Rust SQLite plus Supabase unless an Apple option passes every row above.

## 11. Sync path

### 11.1 Problem

Accounts are in v1.0, so sync is on the v1.0 critical path.

- The current design downloads the full account twice per sync and plans over
  full snapshots.
- Without JIT, the snapshot planner took 10.0 s for 4,521 entities and 40.9 s
  for 18,021 entities on an M5 (0.98 s and 3.7 s with JIT). An iPhone 11 is
  likely 2–3× slower.
- That cannot run in the no-JIT tracking engine, in the foreground or in a
  background entry.

### 11.2 Recommendation: incremental cursor or delta sync

Replace full-snapshot planning with cursor-based deltas.

- The client keeps a hosted cursor per entity kind. Each sync pulls only rows
  changed since the cursor and pushes only outbox rows.
- The planner merges a bounded delta against the local rows it touches. Cost
  scales with changes since the last sync, not with account size.
- Work runs in bounded steps that fit the tracking engine's budget, or in a
  small native merge where the rule is mechanical. Domain rules stay in
  TypeScript.
- It benefits every client: iPhone, Mac and hosted server load. It is
  cross-platform work under `AGENTS.md` and needs its own tickets and a sync
  contract bump.
- Tombstones, the transactional outbox and cursors are already in the desktop
  design (Tickets 116–122). Delta sync extends them; it does not start over.

### 11.3 Fallback: snapshot planner in a hidden `WKWebView`

Only if delta sync cannot land in time. Risks:

- JIT in `WKWebView` is widely reported but undocumented.
- Background web content is suspended, so sync stays foreground-only.
- Lockdown Mode may disable JIT, which returns the 10–40 s cost.
- It adds a third JavaScript runtime to the app.

### 11.4 Required in either path

- Sync journal for two-commit recovery: persist planned local writes, the
  merged result and the idempotency key before the hosted call. On recovery,
  check the hosted receipt and finish the local side in one transaction.
- `history_branch` as a reviewable conflict. Today
  `packages/core/src/resolvers/account-sync.resolver.ts:1000` still throws
  "branched status history" (rechecked on `64b78b80`), which halts all sync.
  Divergent marks must open review while other entities still sync.
- Uniqueness pre-pass in the planner: same-slot Occurrences and two running
  sessions. Merged plans can violate hosted unique keys today.
- `SyncCoordinator` extracted from React (`apps/desktop/src/account/`) into
  `packages/local-runtime`, so the Mac and iOS share it.
- Sync runs only in the foreground, debounced, never inside a background entry.
  `BGAppRefreshTask` never syncs.
- Version skew: a hosted synced-field change before the iOS update shows
  "Update required".
- Linked devices each fire reminders. A per-device "Reminders on this device"
  setting (not synchronized) follows, with a desktop follow-up.

## 12. Project layout and build

```text
apps/ios/
  Cadence.xcodeproj         targets created by the owner from Xcode templates
  Config/Base.xcconfig      #include? "Local.xcconfig" (gitignored: team, bundle prefix)
  Cadence/                  app entry, delegate adaptor, scene wiring
  CadenceWidgets/           extension entry
  CadenceWatch/             watch entry (v1.1)
  CadenceWatchWidgets/      watch widget entry (v1.1)
  Packages/CadenceKit/      all code: Models, DesignSystem, ReadModels, Engine,
                            Store, Notifications, Intents (AppIntentsPackage), WatchBridge
crates/cadence-local-store/, crates/cadence-local-store-ffi/
packages/local-runtime/     shared TS local-first services, SyncCoordinator
packages/mobile-engine/     JSContext entry points and host bindings
rust-toolchain.toml         pinned toolchain with aarch64-apple-ios and aarch64-apple-ios-sim
```

- None of these paths exists on `64b78b80`: no `crates/`, no
  `rust-toolchain.toml`, and `packages/` holds `core` and `ui` only.
- App Intents live in the shared package. `AppDependencyManager` injects the
  engine in the app process.
- Agents edit `Package.swift`, not `project.pbxproj`. No XcodeGen or Tuist.
- `npm run ios:prepare` builds the engine bundle, XCFramework, generated Swift
  contracts and tokens outside Xcode. The Xcode build only verifies a stamp
  file; Xcode build scripts are sandboxed and lack the shell `PATH`.
- Entitlements derive the App Group and keychain group from the bundle prefix.
  Agents never pass `-allowProvisioningUpdates` or change signing without owner
  approval.

## 13. Performance budgets (`IOS-189`)

Fix targets before measuring. Run 20 cold launches and 100 writes per device in
Release builds. Record device, OS build, thermal state and bundle hash. If a
metric stays above twice its target after one optimization pass, decide the
fallback with the owner.

| Metric (iPhone SE 2nd gen and iPhone 11) | Target |
|---|---|
| First Timeline frame from read model, cold | ≤ 500 ms p95 |
| Tracking engine ready, cold | ≤ 300 ms p95 |
| Status commit plus read-model rewrite | ≤ 300 ms p95 |
| Background entry (cold) to committed write and read model | ≤ 2 s p95 |
| Day-change replan, 20 Behaviors | ≤ 1.5 s p95 |
| Export, typical one-year account | ≤ 15 s with progress |
| Import preview, typical one-year account | ≤ 10 s with progress |
| Engine heap steady state | ≤ 80 MB |
| Widget extension memory, largest read model | ≤ 15 MB |
| **v1.0 addition:** foreground sync, typical one-year account, 1 day of changes | ≤ 2 s p95, off the main thread, never blocking a status write |
| **v1.0 addition:** first sync after sign-in, typical one-year account | ≤ 15 s with progress; tracking usable before it ends |

The two sync rows are new for v1.0 and are proposals, not measured. They assume
delta sync (Section 11.2).

Fallbacks: tracking misses → D-lite (policy change). Portability misses →
heavy-job `WKWebView` evaluation or algorithm work. Sync misses → owner
decision between more delta work and the `WKWebView` fallback.

## 14. Observability

- No third-party SDK.
- A local ring buffer records operation timings, error codes and the bundle
  hash. It never records Note text, Behavior names or tokens.
- `MetricManager` (iOS 27) collects metrics and diagnostics. `MXMetricManager`
  is deprecated in iOS 27.2. The person exports diagnostics on request.
- `os.Logger`: dynamic values are private by default. Mark only codes and IDs
  public. Sysdiagnose collects logs.
- Xcode Organizer shows crashes only from people who share analytics. Keep
  dSYMs for the app, every extension and the Rust library.

## 15. Acceptance

From Part B, Section 10.1, account rows now in v1.0:

1. Offline Lock Screen Not Completed against web Completed → reviewable
   conflict; other entities still sync.
2. iPhone offline 3 days while web or desktop extends the horizon → no
   uniqueness violation.
3. Kill after the hosted commit, then edit a pushed entity → converges.
4. Account deleted on iOS while desktop syncs → desktop terminal state.
5. Hosted synced-field change before the iOS update → "Update required".
6. Airplane mode for a day of normal use: every Section 2.1 feature works; sync
   on reconnect leaves web and iPhone identical.
7. Each Section 2.2 feature offline: its offline state shows; tracking is
   unaffected.
8. Sign in with Apple revoked in iOS Settings while Cadence is in the
   background → signed out on foreground.
9. Account deletion → every Section 4 local item is gone, including the watch
   cache and Keychain.
10. TestFlight N+1 to N with a newer schema → fails closed.
11. iCloud restore to a new device → sign-in required before surface writes.
12. Storage full during a notification action → visible failure, no
    corruption.

## 16. Cross-platform prerequisites

Web and desktop work the iPhone needs. Web work is never asked to close one; the
iOS track tickets them at activation.

| Change | Web | Desktop |
|---|---|---|
| Incremental cursor or delta sync, with a sync contract bump | Yes | Yes |
| `history_branch` as a reviewable conflict | Yes | Yes |
| Uniqueness pre-pass in the planner | Yes | Yes |
| Sync journal; `SyncCoordinator` into `packages/local-runtime` | — | Yes |
| `commandId` replay in the command contract | Yes | Yes |
| Code-point or explicit-locale comparisons in core | Yes | Yes |
| Temporal polyfill on native BigInt | Yes | Yes |
| Locale-aware time display; host formatter for notification text | Yes | Yes |
| Typed Behavior validation in core | Yes | Yes |
| Store crate, FFI, `auth.rs` operations | — | Yes |
| Terminal "account deleted" state | — | Yes |
| Deletion API with bearer auth, Apple revocation, server notifications, Sequenzy deletion | Yes | Follow-up |
| `apple-app-site-association` | Yes | — |
| Private Email Relay sender registration | Hosted | — |

## 17. Open items

- Native Sign in with Apple needs a D31 scope change at activation.
- How the hosted Turnstile check runs in the native email-code flow.
- Whether D31's Calendar sign-in rule removes `same_account_required` for Apple
  sign-in users.
- The delta sync design and its sync contract number. Allocate the number with
  `npm run ids:next` at activation, never in this plan.
- Whether any Apple-only auxiliary state exists that CloudKit could hold.
