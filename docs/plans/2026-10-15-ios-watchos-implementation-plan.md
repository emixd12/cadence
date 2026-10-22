# Cadence iOS and watchOS implementation plan

Status: FINAL PROPOSAL v1.0. Not authorized for implementation. Date:
2026-10-15. Owner approval of Section 14 is required before Ticket 188.

This plan replaces the iOS assumption in the August 25, 2026 desktop scoping
(a later `tauri ios init` of the desktop WebView app). It does not change product
scope by itself. `AGENTS.md`, `docs/PRODUCT_SPEC.md`, and
`docs/PUBLIC_PRODUCT_ARCHITECTURE.md` still defer native mobile. Ticket 188
activates the track and updates those documents.

Process: a draft (v0.9) went through five adversarial reviews (architecture,
Apple platform claims, App Store compliance, data and sync, delivery and
tooling). Their claims were checked against the code and Apple's
documentation before adoption. A semi-final (v0.95) then received an
expert iOS-developer pass. Section 18 records what each review changed.

## 0. Summary

**Recommendation.** Build a native Swift app family: an iPhone app, one
extension for widgets, Live Activities, and Controls, and a dependent watchOS
app. Keep the TypeScript core as the only implementation of domain rules. Run it
on the iPhone in JavaScriptCore:

1. A **tracking engine** (`JSContext`, no JIT) on a dedicated thread for
   statuses, Notes, timing, generation, reminders, and read models. It serves
   every background entry point.
2. A **portability engine** (a second `JSVirtualMachine` on its own thread) for
   export, ZIP, and BehaviorLog import and restore, with visible progress.

Persistence reuses the desktop's Rust SQLite store through a small C interface.
Extensions and the watch render engine-computed read models and route every
write to the iPhone app process.

**Releases.**

| Release | Contents |
|---|---|
| v1.0 local-first | iPhone daily loop, Behaviors, analytics, Settings, reminders with actions, widgets, timing Live Activity, Controls, core App Intents, Export/Import. Apple Watch support through mirrored notifications, Live Activities in the Smart Stack, and iPhone Controls on the watch |
| v1.0.x | Native watch app (complications, Smart Stack cards, list, offline queue), Siri and Spotlight, optional scheduled "upcoming" Live Activity |
| v1.1 accounts | Apple and Google sign-in, sync, conflict review, account deletion, Daily Brief with AI consent, Calendar when its identity and verification gates pass |

A local-only v1.0 needs no login, account deletion, or AI consent at review,
and it does not wait for the sync work that the measurements require.

**Five facts that shaped the plan.**

1. Without JIT, the shared sync planner runs about 10× slower. A 4,521-entity
   plan took 10.0 s on an Apple M5 Mac versus 0.98 s with JIT. An iPhone 11 is
   likely 2–3× slower than the M5. Sync cannot run in the no-JIT engine, and
   React Native (Hermes, also no JIT) is not an escape.
2. The tracking workload fits: 20 Behaviors over 37 days took 168–204 ms
   without JIT once the Temporal polyfill uses native BigInt.
3. The shared core has latent bugs that iOS exposes: default-locale sorting
   changes order and fingerprints under some device languages; divergent
   status history halts all sync instead of opening review; merged sync plans
   can violate uniqueness rules; status writes ignore a caller's expected
   state.
4. App Store blockers exist today: public copy says no AI provider receives
   data while the Daily Brief uses OpenAI; Terms require age 18+, so the rating
   must be overridden; reviewers cannot reach Calendar.
5. Practical gaps: full Xcode is not installed; the Apple membership is
   individual; several apps already use the name "Cadence"; the shipped
   completion chime has unrecorded provenance.

## 1. What changed since the August scoping

| August assumption | Finding | Consequence |
|---|---|---|
| iOS is `tauri ios init` of the desktop app | Apple Watch has neither WebKit nor JavaScriptCore | The watch is a native Swift app |
| Widgets are plugin work | Widgets, Live Activities, and Controls run as separate extension processes with tight memory ceilings | Extensions render read models only |
| The WebView runs the core | Background entry points launch the app without UI | Background writes need an in-process engine |
| One JS runtime is enough | No JIT in `JSContext`; sync and portability are 9–18× slower without it | Tracking stays in the engine; sync needs a different path |
| No App Store work | Sign in with Apple, deletion, AI consent, age assurance, privacy manifests | Hosted, web, and desktop changes in v1.1 |

## 2. Evidence base

### 2.1 Measurements

Apple M5 Mac, system `jsc`, `--useJIT=false --useRegExpJIT=false` for no-JIT,
measured by the architecture review and reproduced on 2026-10-15. These are not
iPhone numbers. Assume an iPhone 11 runs 2–3× slower (inference from
single-core benchmark ratios).

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

### 2.2 Verified platform facts

Primary Apple sources unless labeled.

- `LiveActivityIntent` and `AudioPlaybackIntent` run in the app's process;
  other widget intents run in the extension (WidgetKit, "Adding interactivity").
- iOS 27 `IntentExecutionTargets` lets an intent or entity query run only in
  `.main`, `.appIntentsExtension`, or `.widgetKitExtension`. Apple describes
  sharing intents through a Swift package or framework.
- Widget and Live Activity buttons are inactive on a locked device until the
  person authenticates.
- Live Activities: 8 h active, 12 h on the Lock Screen, 4 KB data, no network;
  buttons do not act in CarPlay; scheduled starts (iOS 26) need an alert
  configuration and count toward the simultaneous limit; background starts
  need a `LiveActivityIntent`, a push, or a schedule.
- JavaScriptCore is not available on watchOS. The SDK has no public bytecode
  cache or execution watchdog.
- Widget reloads: 40–70 a day for frequently viewed widgets; intent and
  foreground reloads are exempt; background-launched reloads count.
- `ThisDeviceOnly` Keychain items restore to the same device, not another.
- Watch: background notification actions run on the target device (the
  iPhone); foreground actions run where selected. `sendMessage` from an active
  watch app wakes the iPhone app; `transferUserInfo` does not work in Simulator.
- iPhone Controls can appear on Apple Watch on watchOS 26 and run on the iPhone
  (WWDC25 session 334, cited by the platform review).
- `openAppWhenRun` is deprecated in iOS 26; use `supportedModes`.
- `BGContinuedProcessingTask` (iOS 26) keeps user-started work running in the
  background, shows progress in a system Live Activity, and lets the person
  cancel it.
- MetricKit: `MetricManager` is new in iOS 27; `MXMetricManager` is deprecated
  in iOS 27.2.
- Accessibility Nutrition Labels are voluntary now; Apple says they will become
  required, with no date.
- 64 pending local notifications per app (Apple engineer, developer forum
  thread 811171, January 2026; forum evidence).
- iOS 27 supports the same iPhones as iOS 26. watchOS 27 drops Series 6–8,
  SE 2, and the original Ultra.

## 3. Scope, releases, and parity

### 3.1 Supported platforms

1. Web (Next.js, Supabase). Adds Sign in with Apple in v1.1.
2. macOS desktop (Tauri, local-first, optional account). Adds Sign in with
   Apple and an account-deleted state in v1.1.
3. iOS app family: iPhone app, extension, watchOS app.

Android stays out of scope. iPad runs the iPhone app in compatibility mode.
Turn off availability on Apple silicon Macs and visionOS; the native desktop app
covers the Mac.

### 3.2 Parity rule

Parity means every applicable `interaction-registry.json` intent works on each
platform where it applies, with evidence. Reuse an intent ID when the intent is
unchanged. A widget, notification, Control, Siri, or watch trigger that marks an
Occurrence Completed is another trigger of `INT-TIMELINE-005`. Platform-only
capabilities get new IDs with not-applicable reasons elsewhere.

### 3.3 Parity matrix

| Area | Web | Desktop | iOS v1.0 | iOS v1.1 | Watch |
|---|---|---|---|---|---|
| Timeline: statuses, Needs decision, Notes, timing, correction, feedback, day-progress layout | Yes | Yes | Yes | Yes | v1.0: notifications, Live Activity, Controls. v1.0.x: list, mark, timing |
| Behaviors: CRUD, schedules, ranges, categories, archive, notes, duration, end date, filters | Yes | Yes | Yes | Yes | No |
| Analytics and selected-day review | Yes | Yes | Yes | Yes | No |
| Note shortcuts | Yes | Yes | Yes | Yes | No |
| Reminders | Push and email | Native, verified horizon | Native, verified horizon | Plus per-device toggle | Mirrored notifications |
| Export (5 formats) and BehaviorLog import/restore | Yes | Yes | Yes | Yes | No |
| Raw database backup/restore | No | Yes | No (BehaviorLog backup, iCloud device backup) | No | No |
| Account link, sync, conflicts, disconnect | Sign-in only | Yes | No | Yes | Inherits iPhone |
| Sign in with Apple | v1.1 | v1.1 | No | Yes | No |
| Account deletion | Yes | v1.1 terminal state; deletion follow-up | No account | Yes | No |
| Calendar context | Yes | Yes | No | After identity and verification gates | No |
| Daily Brief | Yes | Yes (linked) | No | Yes, with AI consent | No |
| Travel | Disabled in production | Disabled in production | No | When production enables it | No |
| Widgets, Live Activities, Controls, Siri, Spotlight | No | No (macOS widget follow-up) | Widgets, timing activity, Controls, core intents | Plus Siri and Spotlight (v1.0.x) | Smart Stack, Controls; complications in v1.0.x |

### 3.4 Registry changes

- Schema 1.4.0: native surfaces may omit `routes`; keep `additionalProperties:
  false`. Add an optional `entry_points` list on the `mobile` record, used only
  where triggers differ: `INT-TIMELINE-002/005/006/008/009` and
  `INT-NOTIFICATION-001`.
- `scripts/check-interactions.mjs`: scan Swift sources; add
  `--mobile-release <milestone>` that checks only that milestone's intents.
- Reclassify: `INT-AUTH-004`…`014` become applicable in v1.1.
  `INT-DESKTOP-002` (updater) changes from deferred to not applicable. Daily
  Brief and Travel entries change from not applicable to deferred.
- One agent per milestone edits the registry.

### 3.5 Out of scope

HealthKit, CloudKit, background location, geofencing, AlarmKit, Mac Catalyst,
iPad-optimized layouts, an independent watch sync client, streak or score
framing, push marketing, in-app purchases, Critical Alerts, Time Sensitive
notifications, badges, and provisional notification authorization. Each needs
its own ticket.

## 4. Architecture

### 4.1 Options

| Option | Rules | UI | Heavy work | Verdict |
|---|---|---|---|---|
| A. Tauri iOS | TS in WKWebView (JIT) | Shared React DOM | Fast | Background writes still need an in-process engine; web-feel UI |
| A-hybrid. Tauri UI + JSContext for background | TS | Shared React DOM | Fast | Maximum-reuse alternative; weaker native quality |
| B. React Native/Expo | TS in Hermes (no JIT) | React Native | Slow; Hermes `Intl` gaps | Rejected |
| **C. SwiftUI + JSContext engines + Rust store** | TS | SwiftUI | Portability slow but bounded; sync needs a separate path | **Recommended**, gated by Ticket 189 |
| D. Full Swift port | Swift | SwiftUI | Swift | Rejected; duplicates ~30k lines |
| D-lite. Swift port of the tracking slice (~3–4k lines) | Mixed | SwiftUI | TS | Fallback if device budgets fail; needs an `AGENTS.md` policy change |

### 4.2 Topology

```text
iPhone app process (only writer of cadence.sqlite3)
  SwiftUI screens
  EngineHost   (serial executor, VM 1)  JSContext: CadenceEngine.js tracking scope
  PortabilityHost (own thread, VM 2)    JSContext: same bundle, export/import
  StoreGateway  Rust cadence_local_store (C ABI, JSON) -> cadence.sqlite3
  Adapters      notifications, Keychain, URLSession, WatchConnectivity, ActivityKit
  ReadModelWriter  atomic JSON in App Group ReadModels/v1/
Widget extension (read-only): widgets, Live Activity UI, Controls UI
watchOS app + watch widgets (v1.0.x): cache and command queue
Hosted (v1.1): Supabase, Next.js APIs
```

One bundle built from `packages/core` and the extracted `packages/local-runtime`
loads in both VMs. Every store write passes through `StoreGateway`.

### 4.3 Single-writer rule and entry points

The database lives in app-private Application Support. Extensions read atomic
JSON files. Apple's `0xDEAD10CC` termination covers file and SQLite locks held
during suspension, so every write runs inside `beginBackgroundTask`.

Minimum iOS 27.0.

| Entry point | Process | Mechanism |
|---|---|---|
| In-app controls | App | Engine call |
| Notification action | App, background launch | Delegate assigned in a `UIApplicationDelegateAdaptor` before launch finishes |
| Widget button | App | Intent in the shared package with `allowedExecutionTargets = .main` |
| Live Activity button | App | `LiveActivityIntent` |
| Control (Control Center, Lock Screen, Action button, Apple Watch) | App | `.main` target; `authenticationPolicy` chosen per intent |
| Siri, Shortcuts, Spotlight | App | Shared-package intent, `supportedModes` |
| Watch app action (v1.0.x) | iPhone app | `sendMessage` or queued `transferUserInfo` |
| Background refresh | App | `BGAppRefreshTask`, reminder top-up only; never sync |

Background launches create no scenes. Create the engine, activate
`WCSession`, set the notification delegate, and register background tasks in
the app delegate, never in `onAppear`.

Locked device: widget and Live Activity buttons are inactive until unlock.
Notification actions, Controls, and Siri can run while locked. Before first
unlock after a reboot, protected data is unavailable: entry points report
failure and never claim success. No API redelivers a notification response.

### 4.4 Tracking engine

- Scope: statuses, Notes, timing, generation and replanning, reminder planning
  and coverage, read models, analytics, Behavior and category writes, timezone
  changes.
- Before device measurement: Temporal polyfill on native BigInt, native SHA-256
  through a host function, and code-point comparisons in core (Section 6).
- Host ports: `StorePort`, `NotifierPort`, `HttpPort` (Swift injects the access
  token; the engine never sees the refresh token), `SecretPort`, `ClockPort`,
  `CryptoPort`, `LogPort`, `FilePort`, and a display-format port (Section 4.8).
- Globals to provide (measured inventory): `crypto.randomUUID` (21 uses),
  `crypto.subtle.digest`, `atob`/`btoa`, `TextEncoder`/`TextDecoder`, `URL`,
  `AbortController`, `fetch`, timers.
- Move `parseBehaviorFormData` validation (`lib/services/behavior-form.ts`) into
  core as typed validation; it holds domain limits.
- Threading: a dedicated serial executor keeps 100–400 ms calls off the shared
  thread pool. One `JSVirtualMachine` serializes its contexts, so long work runs
  in the second VM. If deep recursion raises `RangeError`, run the VM on a
  thread with a larger stack (unverified).
- Observability: no third-party SDK. A local ring buffer records operation
  timings, error codes, and the bundle hash. `MetricManager` (iOS 27) collects
  metrics and diagnostics; the person exports them on request. Xcode Organizer
  shows crashes only from people who share analytics.
- Memory: `JSGarbageCollect` after large operations; reject oversized inputs
  before parsing.

### 4.5 Heavy work

- v1.0: export, ZIP, and BehaviorLog import and restore run in the portability
  VM with progress and cancellation. `BGContinuedProcessingTask` keeps a
  user-started job running when the app goes to the background. Apply stays one
  store transaction.
- v1.1 sync is a separate decision (Section 14): the existing snapshot planner
  in a hidden `WKWebView` (JIT is widely reported but undocumented, background
  web content is suspended, and Lockdown Mode may disable JIT), or an
  incremental sync design that benefits all clients. The current design
  downloads the full account twice per sync.

### 4.6 Command contract (new core rule)

Writes from notifications, widgets, Live Activities, Controls, Siri, and the
watch carry:

```ts
{ commandId, capturedAt, expectedStatus, expectedLatestEventId, expectedSessionId? }
```

- The store returns a prior result for a known `commandId` (domain outbox rows
  are retained) before planning. Lost replies cannot double-apply.
- Same status already current: success. Different status current: reject with
  "Already marked elsewhere".
- `recorded_at = max(now, latest.recorded_at + 1 µs)`. Completion and timing
  instants use `capturedAt`, clamped between the read model's `generatedAt` and
  now.
- Timing stop names its session.
- Notification "Add Note" rejects if a Note exists and opens the Occurrence.
  Note text from the Lock Screen requires authentication.
- Today `applyOccurrenceStatusTransition` re-reads the latest event and ignores
  a caller expectation (`packages/core/src/services/occurrence.service.ts`).

### 4.7 Persistence

- Extract `local_store` into `crates/cadence-local-store`. A scratch extraction
  that removed only `tauri::State` passed `cargo check` and 88 tests on the host.
  iOS cross-compilation is unverified until Xcode is installed.
- Move into the crate's request set: account metadata, first-link, and
  sync-completion transactions (`src-tauri/src/auth.rs`), plus disconnect and
  backup (`files.rs`).
- `recovery.rs` spawns `/bin/df`; iOS forbids subprocesses. Gate it (only
  databases older than schema 14 reach it). Wrap the FFI in `catch_unwind`.
- FFI: `open`, `invoke(json) -> json`, `close`, `free`. Static XCFramework for
  iOS device, iOS simulator, and macOS (host-side Swift tests). Release profile
  `debug = "line-tables-only"`, `strip = false`; upload symbols and keep every
  archive.
- One schema and migration chain for desktop and iOS (schema 17 today). CI
  compares migration hashes.
- File protection `completeUntilFirstUserAuthentication` for the database,
  WAL, SHM, and read models. Exclude read models and export temp files from
  backup.
- Map `SQLITE_FULL` to a visible failure at every entry point.
- Migrations run only in the foreground. A background launch with a pending
  migration rejects the command visibly.
- A database newer than the app (a TestFlight downgrade) enters "Update
  Cadence" mode: no reset, no read-model writes, no background writes.
- Restore detection: an install UUID in SQLite and in a `ThisDeviceOnly`
  Keychain item. A mismatch means a restore to another device: regenerate read
  models and reschedule reminders; in v1.1, also require sign-in or "continue
  offline" before surface writes. Treat `errSecInteractionNotAllowed` as
  unavailable, never absent. Clear stale Keychain slots on a fresh install only
  after first unlock.

### 4.8 Read models

- `timeline.json`, `widget.json`, `watch.json`, written atomically, with
  `generatedAt`, `validUntil`, `schemaVersion`, `databaseRevision`, the profile
  timezone, and several upcoming local midnights with precomputed groupings.
- Each actionable row carries its expected status, latest event ID, and the
  engine-computed result of each action (status, tone, group). Swift shows that
  result immediately and never decides a status rule.
- Times are structured values. Swift formats them with `Date.FormatStyle` in the
  Behavior timezone, honoring the person's 12/24-hour and region settings. The
  engine formats notification text through a host-supplied formatter, so
  coverage readback compares exact strings. Core's `formatClockTimeLabel`
  hard-codes 12-hour English output today.
- After each commit: write read models, then debounce `WidgetCenter` reloads,
  `ControlCenter.shared.reloadControls(ofKind:)`, Live Activity updates, and the
  watch context. Reload once more when the app moves to the background.

### 4.9 Project layout and build

```text
apps/ios/
  Cadence.xcodeproj         four targets created by the owner from Xcode templates
  Config/Base.xcconfig      #include? "Local.xcconfig" (gitignored: team, bundle prefix)
  Cadence/                  app entry, delegate adaptor, scene wiring
  CadenceWidgets/           extension entry
  CadenceWatch/             watch entry (v1.0.x)
  CadenceWatchWidgets/      watch widget entry (v1.0.x)
  Packages/CadenceKit/      all code: Models, DesignSystem, ReadModels, Engine,
                            Store, Notifications, Intents (AppIntentsPackage), WatchBridge
crates/cadence-local-store/, crates/cadence-local-store-ffi/
packages/local-runtime/     shared TS local-first services, SyncCoordinator
packages/mobile-engine/     JSContext entry points and host bindings
rust-toolchain.toml         pinned toolchain with iOS targets
```

- App Intents live in the shared package so widget, Live Activity, and Control
  buttons can reference them; `AppDependencyManager` injects the engine in the
  app process.
- Agents edit `Package.swift`, not `project.pbxproj`. No XcodeGen or Tuist.
- Entitlements derive the App Group and keychain group from the bundle prefix;
  Swift reads them from `Info.plist`, never literals. Keep
  `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` identical across targets.
- `npm run ios:prepare` builds the engine bundle, XCFramework, generated Swift
  contracts, and tokens outside Xcode. The Xcode build only verifies a stamp
  file; Xcode build scripts are sandboxed and lack the shell `PATH`.
- Agents never pass `-allowProvisioningUpdates` or change signing without owner
  approval.
- `.gitignore` additions: `xcuserdata/`, `DerivedData/`, `*.xcarchive`, `*.p8`,
  `*.p12`, `*.mobileprovision`, `*.provisionprofile`, `Local.xcconfig`.
  `apps/desktop/signing/` already holds an untracked Developer ID profile and
  certificate; move them out of the repository.
- Identifiers lock at the first upload. Proposed: `app.cadence.ios`,
  `.widgets`, `.watchkitapp`, `.watchkitapp.widgets`, App Group
  `group.app.cadence.ios`. Register them only after the membership decision.

### 4.10 Design system and native idioms

- Generate `CadenceTokens.swift` from `packages/ui/tokens.css`. The design-system
  check falls back to a skill path on the owner's machine; CI needs
  `DESIGN_SYSTEM_BENCH_SKILL_DIR` or a vendored verifier.
- Native idioms, semantic parity: a tab bar; a `List` Timeline with swipe
  actions and context menus; editors in sheets; `.refreshable`; `.searchable`
  for Behaviors. System bars and sheets carry Liquid Glass.
- IBM Plex Sans with `Font.custom(_:size:relativeTo:)`; system fonts in widgets
  and complications.
- Icon Composer (owner-run): Default, Dark, and Mono, checked at small sizes.
- Completion sound: ambient audio session, respects the silent switch, paired
  haptics, provenance-cleared audio only (Section 7.4).
- Add iOS and watchOS surfaces to `design-system.surfaces.json`; SwiftUI
  previews and snapshot tests are the native bench evidence.

## 5. Feature design

### 5.1 Reminders

- The engine plans requests nearest first, as on desktop. Swift adds them with
  Gregorian calendar triggers pinned to UTC and checks `nextTriggerDate()`.
- Capacity: 64 pending per app (forum statement). Keep a reserve, read back,
  and compute contiguous coverage. Show "Reminders scheduled through" in
  Settings and a Timeline notice when coverage is short.
- Re-plan on launch, foreground, day change, timezone change, significant time
  change, every write, every notification action, the Lock Screen privacy
  toggle, and `BGAppRefreshTask` (opportunistic; stops after force quit and in
  Low Power Mode).
- Swift schedules exactly the strings the engine planned, including redacted
  text. Persist delivery evidence to SQLite promptly; desktop holds it in
  memory, which suspension would lose.
- Actions: Completed, Not Completed, Add Note, in that order.
  `threadIdentifier` per Behavior; `hiddenPreviewsBodyPlaceholder` set.
- Permission: ask once, in context, after the first Behavior exists. If denied,
  link to the app's notification settings. No badge: a count cannot update at
  midnight without the app running.
- v1.1: a per-device "Reminders on this device" setting (not synchronized),
  with a desktop follow-up; linked devices otherwise each fire. Hosted APNs
  remains a later option.

### 5.2 Live Activities

- v1.0 timing activity: starting time tracking in the app starts it. It shows
  `Text(timerInterval:)` in a constrained frame and a Stop button
  (`LiveActivityIntent`, names its session). Stop requires unlock. The activity
  ends at 8 hours; the session continues in Cadence.
- A timer started from the watch or a notification cannot start an activity
  (background); the next foreground launch offers it.
- v1.0.x option: an opt-in "upcoming Behavior" activity scheduled from the
  foreground. The reminder notification stays.
- `.small` family for Apple Watch and CarPlay.

### 5.3 Widgets and Controls

- v1.0: small, medium (interactive), Lock Screen rectangular and inline.
  Large and StandBy-specific layouts follow use.
- Status never relies on color alone. Test accented, clear, vibrant (Lock
  Screen), luminance-reduced (Always-On), and StandBy night mode. Use
  `widgetAccentable()`, `privacySensitive()` on names, and
  `invalidatableContent()` on buttons.
- Controls: "Complete" configured per Behavior (`AppIntentControlConfiguration`
  with `promptsForUserConfiguration`); the engine picks that Behavior's earliest
  unresolved eligible Occurrence today (new core rule with tests). "Start or stop
  timing" (`SetValueIntent` and `LiveActivityIntent`). Controls appear on Apple
  Watch through the iPhone app.
- Decide whether iPhone widgets may appear on the Mac (default on).

### 5.4 App Intents, Siri, Spotlight

- Core intents ship in M2, before widgets: mark Completed, mark Not Completed,
  add Note, start/stop timing, open Timeline, open Needs decision, open
  Behavior.
- Configuration entity queries read the read model or run with `.main`.
- v1.0.x: App Shortcuts with the app name in every phrase, `UndoableIntent`
  for Siri-driven marks, Spotlight indexing as a setting (removal clears the
  index), `LongRunningIntent` export intents.
- App Intents Testing (iOS 27) in CI.

### 5.5 Apple Watch

- v1.0 without a watch app: mirrored notifications with actions, the timing
  Live Activity in the Smart Stack, iPhone Controls on the watch.
- v1.0.x watch app: Today, Needs decision, mark, timing start/stop;
  complications and RelevanceKit Smart Stack cards.
- Data: a compact snapshot through `updateApplicationContext`. Commands follow
  Section 4.6, one outstanding command per Occurrence, versioned both ways.
  Queued commands show "Pending".
- Complete `WKWatchConnectivityRefreshBackgroundTask` only after
  `hasContentPending` is false. Compare `transferCurrentComplicationUserInfo`
  (reported limit of 50 a day, only with a Cadence complication on the active
  face) with `updateApplicationContext` in Ticket 201a. Show "Unlock your
  iPhone" when `iOSDeviceNeedsUnlockAfterRebootForReachability` is true.
- Double tap: one primary action per screen. Notification double tap works only
  on Series 9, Ultra 2, and later.
- watchOS 26 minimum if a watchOS 26 watch pairs with an iOS 27 iPhone (forum
  reports say yes; no Apple document); otherwise watchOS 27.

### 5.6 Accounts and sync (v1.1)

- Providers: Sign in with Apple (hashed nonce to Apple, raw nonce to Supabase
  `signInWithIdToken`) and Google (Supabase OAuth with PKCE in
  `ASWebAuthenticationSession`, `Callback.https` with an associated domain).
  Guideline 4.8 requires an equivalent privacy-preserving login option; Sign in
  with Apple satisfies it. The Apple button is at least as prominent as
  Google's and visible without scrolling.
- Check Apple credential state when the app comes to the foreground and
  observe the revocation notification. Apple returns the name only on first
  authorization.
- Linking: Apple "Hide My Email" accounts do not auto-link to Google accounts.
  If sign-in returns a minutes-old account with no data, offer "I use Google
  instead" before any import.
- Sync runs only in the foreground, debounced, never inside a background entry.
  Persist a sync journal (planned local writes, merged snapshot, idempotency
  key) before the hosted call; on recovery, check the hosted receipt and finish
  the local side in one transaction.
- Deletion: re-authentication plus a typed "DELETE" (relay emails make email
  confirmation unusable); export reminder optional; hosted deletion; Apple token
  revocation with the fresh authorization code; Sign in with Apple server
  notifications; Sequenzy subscriber deletion; a retention notice (7-day
  backups, OpenAI retention, other devices). Then keep or remove local data;
  removal clears App Group files, Spotlight, notifications, watch cache, and
  Keychain.
- Desktop gets a terminal "account deleted" state; today it retries a generic
  failure.
- App Review: reviewers who sign in with Apple see an empty account; the review
  notes explain how to add sample data.

### 5.7 Calendar, Daily Brief, Travel

- Calendar requires the sign-in to be the same Google account
  (`same_account_required`). Apple sign-in users cannot connect it, and Google
  verification is incomplete. Ship it on iOS only after the connector supports a
  separately consented Google identity and Google verifies the app.
- Daily Brief: a native consent sheet before first transmission names OpenAI,
  the data sent (Behavior names, schedules, history; Calendar and Notes only if
  enabled), and retention. Consent is revocable and asked again when sources
  expand. Label output as AI-generated. Decide whether Medical and Measurements
  Behaviors are excluded from model input; add a "not medical advice" line.
- Travel is disabled in production. Compile it out of iOS until it ships.

### 5.8 Export and Import

- All five formats and BehaviorLog flows on device, in the portability VM.
- Declare the BehaviorLog bundle file type; import through `.fileImporter` or
  the share sheet; anchor share-sheet popovers for iPad compatibility mode.
- Budget: a typical one-year account finishes well under the capacity fixture's
  measured 15 s (M5, no JIT); Ticket 189 sets device limits. Long jobs show
  progress and survive backgrounding through `BGContinuedProcessingTask`.

## 6. Cross-platform prerequisites and changes

Start after Ticket 187 merges and Ticket 181 publishes; both touch the same
files.

| Change | Web | Desktop | Why |
|---|---|---|---|
| Code-point or explicit-locale comparisons in core (66 `localeCompare` calls, `toLocaleLowerCase`) | Yes | Yes | Lithuanian locale reorders titles and changes restore fingerprints |
| Temporal polyfill on native BigInt | Yes | Yes | 2× faster without JIT |
| Command contract (Section 4.6) | Yes | Yes | Safe retries; stale-premise rejection |
| Locale-aware time display; host formatter for notification text | Yes | Yes | 12-hour English is hard-coded |
| `history_branch` as a reviewable conflict | Yes | Yes | Divergent marks halt all sync ("branched status history") |
| Uniqueness pre-pass in the planner (same-slot Occurrences, two running sessions) | Yes | Yes | Merged plans can violate hosted unique keys |
| Sync journal; `SyncCoordinator` out of React | — | Yes | Two-commit recovery; reuse on iOS |
| Typed Behavior validation in core | Yes | Yes | Removes the `FormData` dependency |
| Store crate, FFI, `auth.rs` operations | — | Yes | Shared persistence |
| Terminal "account deleted" state | — | Yes | iOS deletion while desktop is linked |
| Sign in with Apple, Services ID, 6-month secret rotation | Yes | Yes | Guideline 4.8; Program License Agreement 3.3.5(C) |
| Deletion API with bearer auth, Apple revocation, Sign in with Apple notifications, Sequenzy deletion | Yes | Follow-up | Guideline 5.1.1(v) |
| Calendar identity decoupling; Google verification | Yes | Yes | Apple users and reviewers |
| Public AI disclosure correction (a Ticket 187 gate) | Yes | Yes | Live contradiction |
| `apple-app-site-association`; Smart App Banner after release | Yes | — | Universal Links |
| Private Email Relay sender registration (SPF/DKIM aligned) | Hosted | — | Reminder email to relay addresses |
| Registry schema 1.4.0; Swift scanning | Yes | Yes | Native surfaces |
| `.gitignore` signing and Xcode patterns; move desktop signing files | Yes | Yes | Untracked signing assets in the tree |

## 7. App Store, privacy, and legal

### 7.1 Blockers before submission

| Blocker | Requirement | Plan |
|---|---|---|
| Public copy says no AI provider receives data | 5.1.2(i), 5.1.1(i) | Fix all copy and the processor table before any build that includes Daily Brief (Ticket 187 gate) |
| Terms require 18+ | App Store Connect: a EULA minimum age above the computed rating must be overridden | Override to 18+; Declared Age Range gating |
| Reviewer access | 2.1(a), 2.3.1(a) | v1.0 needs no login; v1.1 review notes with sample data |
| Name collision | 4.1, 5.2.1 | Trademark clearance; distinct App Store name |

The individual membership is not itself a guideline violation (5.1.1(ix)
targets regulated fields or required sensitive data). Upgrade anyway: the LLC
is the licensor and Terms entity, an individual account publishes the owner's
name and EU trader contact details, and Sign in with Apple user identifiers are
scoped to the team.

### 7.2 Requirements

| Area | Requirement | Plan |
|---|---|---|
| SDK | Xcode 26+ and iOS 26 SDK since April 28, 2026 | Xcode 27 |
| 4.8 | Equivalent privacy-preserving login | Sign in with Apple, v1.1, all platforms |
| 5.1.1(i) | Privacy policy URL in App Store Connect and in the app | iOS section, including local-only v1.0 |
| 5.1.1(v) | Account creation requires in-app deletion | v1.1 flow; local data carries no deletion duty |
| 5.1.2(i) | Explicit permission before third-party AI | Native consent (Section 5.7) |
| 4.5.4 | Push not required; no sensitive data | Local notifications; redaction setting |
| 2.5.2 | No downloaded code | Bundle ships in the binary |
| 2.5.4 | Background modes for intended use | `fetch` only |
| 1.4.1 | Medical scrutiny | No medical claims; Productivity category; no Health & Fitness secondary |
| Age | Questionnaire since January 31, 2026; Texas SB 2420 since June 4, 2026 (under an interim stay); Apple shares age signals for new Utah (May 6, 2026) and Louisiana (July 1, 2026) accounts | 18+ override; `isEligibleForAgeFeatures` (26.2), `requiredRegulatoryFeatures` (26.4); block under-18; `RESCIND_CONSENT` server notifications; counsel-approved significant-change policy; rely on Apple's signals |
| EU DSA | Trader declaration | Organization contact details |
| EU GDPR | Representative and transfer terms (counsel) | Consider a US-first launch |
| China | ICP filing needs a Chinese entity | Exclude China mainland |
| Export compliance | Standard encryption | `ITSAppUsesNonExemptEncryption = NO` |
| IPv6 | Review uses IPv6 networks | Test on NAT64 |
| iPad | Review runs iPhone apps on iPad | Test compatibility mode |
| PLA 3.3.5(C) | Same title and equivalent features where Sign in with Apple appears | One product title everywhere |
| Accessibility Nutrition Labels | Voluntary now; required later | Declare only features where every common task works |

### 7.3 Privacy details

- App Privacy label (v1.1; all linked, no tracking): Email Address, Name, User
  ID, Other User Content (Behaviors, Notes, statuses, timing, Daily Brief
  payloads), possibly Health & Fitness (default categories Medical,
  Measurements, and Fitness invite health data; declare unless renamed),
  Precise Location only once Travel ships, IP addresses in server logs per
  Apple's guidance. v1.0 local-only collects nothing.
- Privacy manifest in every bundle: app, widget extension, watch app, watch
  widgets. Expected reasons: `CA92.1`, `1C8F.1`, `C617.1` (SQLite
  `stat`/`fstat`), `3B52.1` (user-picked import files), `35F9.1` if uptime APIs
  appear. Build SQLite with `SQLITE_ENABLE_LOCKING_STYLE=0` or declare a reason
  for `statfs`. Verify with a symbol scan of every binary and Xcode's privacy
  report. (Codes from the compliance review.)
- `os.Logger`: dynamic values are private by default; mark only codes and IDs
  public. Sysdiagnose collects logs.

### 7.4 Assets, notices, and name

- `public/sounds/completion-chime.mp3` is byte-identical to an untracked file
  named like a text-to-audio prompt. Record the generator, plan tier, output
  license, and inputs, or replace it. Two untracked files are YouTube rips of
  Xbox achievement sounds; delete them.
- Acknowledgements screen: IBM Plex (OFL-1.1), ICU crates (Unicode-3.0),
  MIT/Apache/ISC packages.
- Name: the App Store already lists several "Cadence" apps (two "Cadence -
  Habit Tracker", "Cadence: AI Habit Coach", "Cadence - Medication Reminders",
  "Cadence – GLP-1 Tracker"), and Cadence Design Systems exists. Clear the
  trademark, then reserve a distinct name by creating the record.
- Support URL with contact details. Describe every extension in the listing.
  Write "Cadence for Apple Watch". Fictional data in screenshots. Watch
  screenshots once the watch app ships.

## 8. Platform constraints and responses

| Constraint | Response |
|---|---|
| No JIT in `JSContext` | Tracking scope; portability in its own VM with progress; sync decided separately |
| No JavaScriptCore on watchOS | Watch renders snapshots and sends commands |
| Extension memory ceilings (~30 MB reported) | No engine in extensions |
| `0xDEAD10CC` | Private database; `beginBackgroundTask` around writes |
| 64 pending notifications | Nearest first, reserve, readback, visible horizon |
| Opportunistic background refresh | Reminder top-up only |
| Locked-device buttons inactive | Notification actions for Lock Screen marking |
| Before first unlock | Fail visibly |
| Live Activity 8 h, 4 KB, no network, foreground start | Timing activity started in app |
| Widget budget | Precomputed timelines; debounced reloads |
| Keychain survives uninstall | Install marker; clear stale slots after first unlock |
| TestFlight installs older builds | "Update Cadence" mode |
| Background launches create no scenes | Wire launch-critical services in the app delegate |

## 9. Budgets and decision rule (Ticket 189)

Fix targets before measuring. Run 20 cold launches and 100 writes per device in
Release builds. Record device, OS build, thermal state, and bundle hash. If a
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

Fallback: tracking misses → D-lite (policy change). Portability misses →
heavy-job `WKWebView` evaluation or algorithm work.

## 10. Verification

- Engine conformance: shared fixtures through Node and both JSContext VMs,
  byte for byte, including DST, monthly fallback, fingerprints, and import
  plans, under en, da, tr, et, lt, th-TH, ja-JP with the Japanese calendar, ar,
  and 24-hour time.
- Rust store: cargo tests plus Swift FFI tests on simulator and device.
- Swift: Swift Testing; snapshot tests pinned to one simulator, OS, and Xcode,
  including an AX5 text-size snapshot at the SE width; at most five XCUITest
  journeys with `performAccessibilityAudit()`; App Intents Testing; XCTMetric on
  devices.
- Accessibility: each Occurrence is one VoiceOver element ("Behavior, time,
  status") with custom actions; day headers and Needs decision are headers;
  status changes are announced; actions stack with `ViewThatFits` at
  accessibility sizes; Voice Control labels match visible names.
- Manual on hardware: StandBy, Dynamic Island, locked-device actions, watch
  transfers, first unlock after reboot, storage full, Low Power Mode.
- Dogfood each milestone 7–14 days across midnight. The first real
  daylight-saving change is likely March 14, 2027; test DST earlier with
  timezone fixtures.
- Evidence states: PASS, FAIL, UNVERIFIED, N/A. No FAIL is not release-ready
  while a required item is UNVERIFIED.

### 10.1 Required iOS acceptance scenarios

1. Force quit, then each entry point: widget, Control, notification, watch.
2. Notification action on a locked phone after first unlock; before first
   unlock.
3. Widget button with Live Activities disabled.
4. Watch reply lost, then a `transferUserInfo` retry: exactly one event.
5. Queued watch tap applied after midnight: completion time equals tap time;
   repeat with the watch clock ±2 minutes.
6. First background launch after an update with a pending migration plus a
   notification action.
7. TestFlight N+1 to N with a newer schema: fails closed.
8. iPhone N+1 with watch N, and the reverse.
9. Delete and reinstall with a surviving Keychain item.
10. iCloud restore to a new device; same-device restore of an older backup.
11. Lock Screen redaction toggled: coverage stays complete.
12. Widget tap on a stale read model: rejected, then reloaded.
13. Storage full during a notification action: visible failure, no corruption.
14. v1.1: offline Lock Screen Not Completed against web Completed →
    reviewable conflict; other entities still sync.
15. v1.1: iPhone offline 3 days while web or desktop extends the horizon → no
    uniqueness violation.
16. v1.1: kill after the hosted commit, then edit a pushed entity → converges.
17. v1.1: account deleted on iOS while desktop syncs → desktop terminal state.
18. v1.1: hosted synced-field change before the iOS update → "Update required".

## 11. Agentic workflow and tooling

| Decision | Tools |
|---|---|
| Adopt | Repo scripts (`ios:prepare`, `ios:test:*`, `ios:verify`) as the only agent and CI interface; Claude simulator tools (simulator only); Xcode 27 `mcpbridge` and Device Hub after an M0 comparison; one pinned skill per category (Hudson SwiftUI Pro and Swift Testing Pro, van der Lee Swift Concurrency); swift-snapshot-testing; App Intents Testing; XCTMetric |
| Optional | XcodeBuildMCP (pinned, telemetry off); OpenAI's Build iOS Apps plugin and serve-sim for Codex; `asc` CLI for read-only status (writes need owner approval); Greenlight static scan before submission (a clean scan is not approval) |
| Defer | Xcode Cloud (Node and Rust installs per build consume included hours); a path-filtered, unsigned `xcode-27` GitHub job after M2 (needs a ticket amending the no-CI rule; never `pull_request_target`) |
| Avoid | MobAI (paid, unverified claims); Revyl runtime runs (upload the app binary) |
| Owner-run | Icon Composer; developer portal and App Store Connect writes; first code-signing prompt; first upload |

Secrets: App Store Connect and Sign in with Apple `.p8` keys never enter git or
an agent prompt.

## 12. Milestones and tickets

Sizes count agent sessions: S ≤ 3, M 4–10, L 10–25, XL > 25 or repeated Apple
reviews. No calendar estimate is credible yet. Every milestone ends with a
TestFlight build and dated device evidence; external TestFlight starts in M2.

| Milestone | Tickets | Exit criteria | Size |
|---|---|---|---|
| M0 Ready | 188 activation (docs, scope, no-CI amendment, registry schema); 188a membership upgrade, prerequisites, identifiers, repo hygiene | Owner decisions recorded; membership settled; four-target shell processed in TestFlight and installed on phone and watch | M |
| M1 Engine gate | 189a simulator spike; 189b device run; read-model and command schemas frozen as generated Swift types | Section 9 budgets PASS or fallback decided; independent review | M (XL on fallback) |
| P Cross-platform prerequisites (after 187 and 181) | 190a locale, BigInt, time formatting; 190b typed validation; 190c command contract; 190d store crate and FFI; 190e `packages/local-runtime` tracking services | Web and desktop suites, native tests, installed desktop smoke | L |
| M2 Daily loop | 192 engine packaging and read-model writer; 193 shell and tokens; 194a statuses and Notes; 194b timing; 195a Behavior create/edit; 197 reminders; 198 widgets; 200a core intents | 7–14 days dogfooding; locked-phone actions; midnight rollover; reminder readback; external TestFlight approved | L |
| M3 System surfaces | 199 timing Live Activity and Controls | Dynamic Island, Action button, Controls on watch checked | M |
| M5 Local parity | 195b archive and categories; 195c analytics and Note shortcuts; 196 Settings and onboarding; 208 Export and Import | Milestone release check passes | L |
| M6 v1.0 release | 209 compliance (manifests, 18+, age gating, privacy policy, acknowledgements, audio, name, support URL, screenshots); 211 release manifest, review, manual release | App Store install on a clean device | M |
| M4 Watch app (v1.0.x) | 201a paired-hardware proof; 201b app; 201c complications and Smart Stack; 201d notifications and double tap | Paired matrix on watchOS 26 and 27 | L |
| M4b Siri and Spotlight (v1.0.x) | 200b | App Intents Testing passes | S |
| M7 Accounts prerequisites | 202a Apple sign-in web/desktop; 202b deletion API and revocation; 202c Universal Links; 202d relay email; 202e legal copy; 202f Calendar identity; 202g sync hardening; 202h sync path | Web and desktop releases; sync matrix with two desktops | XL |
| M8 v1.1 accounts | 203 iOS sign-in; 204 link, sync, conflicts, disconnect, deletion; 205 Calendar; 206 Daily Brief | Web, desktop, iPhone, watch matrix | L |

Critical path: M0 → M1 → P → M2 → M5 → M6. During P, build the SwiftUI shell,
widgets, and notification handling against frozen fixture JSON. M3 overlaps M5.
Start M7 owner decisions (linking, age policy, trader status, sync path) in M0.
One change at a time for `packages/core`, the registry, `project.pbxproj`, and
`STATUS.md`/`docs/TICKETS.md`.

## 13. Prerequisites checklist

1. Membership: D-U-N-S number under the LLC's exact legal name (Apple allows
   about five business days at D&B plus two for Apple), then the upgrade. Ask
   Apple in writing whether team `HK26VT477G` survives; it affects desktop
   signing and keychain groups. Turn on auto-renew; a lapse removes the app
   from sale. Keep the change away from release windows (reports describe
   upload blocks during it).
2. Decisions: Section 14.
3. Devices: iPhone SE (2nd gen) or iPhone 11 on iOS 27; a current Dynamic
   Island iPhone with the Action button; a Series 9 or later watch and a
   Series 6–8 watch on watchOS 26; Developer Mode on each; a test Apple Account.
4. Xcode 27 release build and simulator runtimes (not installed today).
5. `rust-toolchain.toml` with `aarch64-apple-ios` and `aarch64-apple-ios-sim`.
6. Developer portal (owner): App IDs, App Group, capabilities, devices.
7. App Store Connect (Account Holder): accept agreements (new versions block
   uploads until accepted, usually after WWDC); create the app record; internal
   tester group; export-compliance key.
8. App Store Connect API key with the Developer role, stored outside git.
9. v1.1: Supabase redirect URLs and Apple client IDs; Services ID and Sign in
   with Apple key; relay sender domain; iOS Calendar callback under the Ticket
   187 Google project; associated domains (Apple's CDN can take up to 24 hours
   to fetch changes).
10. Amend the `AGENTS.md` scope lines and the no-CI line in
    `docs/PUBLIC_PRODUCT_ARCHITECTURE.md`.

## 14. Owner decisions

1. Architecture C with the Ticket 189 gate; D-lite as fallback.
2. Releases: v1.0 local-first; native watch app and Siri/Spotlight in v1.0.x;
   accounts in v1.1. Alternative: hold v1.0 until the watch app is ready.
3. Minimum iOS 27; watchOS 26 if pairing is confirmed, else 27.
4. Upgrade the membership to Identity Scaffolding LLC before registering
   identifiers.
5. Product name after trademark clearance.
6. Age policy: 18+ override plus Declared Age Range gating (counsel).
7. v1.1 sync path: snapshot planner in a `WKWebView`, or incremental sync first.
8. Sign-in linking policy for Apple and Google identities.
9. Allow `BGAppRefreshTask` for reminder top-up (OS-run app execution; current
   docs forbid closed-app helpers).
10. Time display: honor the person's 12/24-hour setting on iOS; decide whether
    web and desktop follow.
11. Daily Brief data scope: exclude Medical and Measurements Behaviors?
12. iPhone widgets on the Mac: allow or disable.
13. CI: amend the no-CI rule for an unsigned build-and-test job after M2.

## 15. Risks

1. Device budgets miss → D-lite with a policy change.
2. Extraction regresses desktop → after 187 and 181; strangler order; native
   and installed checks.
3. Sync design limits on mobile → v1.1 waits for the sync-path decision.
4. App Review blockers → Section 7.1 resolved before submission.
5. Name or trademark conflict → clearance first.
6. Membership upgrade delays uploads → do it first.
7. Solo maintenance across three platforms and a watch → shared engine,
   generated contracts, milestone-scoped parity checks.

## 16. Claims ledger

| Claim | Status | Source |
|---|---|---|
| No-JIT sync and portability 9–18× slower | Measured on M5, not device | Architecture review; reproduced |
| Tracking fits with native BigInt | Measured on M5, not device | Same |
| `LiveActivityIntent` runs in app process | Verified | WidgetKit "Adding interactivity" |
| Locked-device buttons inactive | Verified | Same |
| Shared-package intents and `IntentExecutionTargets` (iOS 27) | Verified | AppIntents DocC |
| Scheduled Live Activity needs alert configuration | Verified | ActivityKit DocC |
| `BGContinuedProcessingTask` progress and cancel | Verified | BackgroundTasks article |
| `MetricManager` iOS 27; `MXMetricManager` deprecated 27.2 | Verified | MetricKit DocC |
| 64 pending notifications | Forum statement | Thread 811171 |
| WKWebView has JIT | Widely reported, undocumented | Not used in v1.0 |
| watchOS 26 watch pairs with iOS 27 iPhone | Forum reports, no Apple document | Ticket 201a |
| Age rating override required for 18+ Terms | Verified | App Store Connect Help |
| Utah/Louisiana age-signal dates | Verified | Apple notice, February 24, 2026 |
| Accessibility Nutrition Labels voluntary now | Verified | App Store Connect Help |
| Several "Cadence" apps on the App Store | Verified by listing search | Web search, October 15, 2026 |
| Organization upgrade timing | Apple D-U-N-S page plus forum reports | Ask Apple |
| `transferCurrentComplicationUserInfo` 50/day | Expert review, not rechecked | Ticket 201a |
| iPhone widgets on Mac by default | Platform review citing WidgetKit docs | Ticket 198 |

## 17. Expert pass: what a first-time iOS developer should know

This section collects knowledge an experienced iOS developer applies by habit.
Most items are also wired into the sections above; this is the checklist view.

### 17.1 How an experienced developer would approach it

- Put real hardware in the loop from week one. Simulator evidence is
  functional evidence only.
- Much Apple Watch value comes from the iPhone app: mirrored actionable
  notifications, Live Activities in the Smart Stack, and iPhone Controls on the
  watch. Ship those first; build the watch app as its own milestone.
- Start with few surfaces (one interactive widget, Lock Screen widgets, the
  timing activity, two Controls) and add variants that dogfooding justifies.
- Design iOS screens natively. Keep semantic parity with web and desktop, not
  visual parity.
- Freeze the read-model and command schemas early, then build UI against
  fixture JSON while shared-code work proceeds.
- Use external TestFlight early: Beta App Review is a cheap guideline check.

### 17.2 Apple account and store operations

- The Account Holder alone accepts agreement updates; uploads stop until they
  do. A free app needs no paid-apps, tax, or banking setup.
- Membership is annual; a lapse removes the app from sale. Turn on auto-renew.
- TestFlight: internal testers need no review; external testers need Beta App
  Review for a version's first build. Builds expire after 90 days.
- Review results arrive in App Store Connect. You can reply, resubmit, appeal,
  or request expedited review. Include steps and a screen recording for system
  surfaces in review notes.
- Phased release applies to updates, not the first version; use manual release
  for v1.0. Promotional text changes without review; other metadata needs a
  submission.
- `requestReview` shows at most three times a year and does nothing in
  TestFlight. Prefer a Settings link to write a review.
- Apple raises the minimum SDK each spring and ships betas each June. Budget an
  annual SDK and OS adoption ticket.

### 17.3 Engineering realities

- iOS suspends an app seconds after it leaves the screen and may terminate it
  without notice. Persist drafts continuously (`@SceneStorage` for UI state, the
  store for data).
- Background launches have no scene; wire launch-critical services in the app
  delegate. Keep migration and engine start off the main thread; the system
  watchdog kills slow launches.
- Compute data dates with the Gregorian calendar and the `en_US_POSIX` locale.
  Display with the person's locale. Devices set to Buddhist or Japanese
  calendars otherwise shift years.
- Dynamic Type at accessibility sizes breaks fixed rows. Custom timelines need
  explicit VoiceOver elements, headers, custom actions, and announcements.
- Widgets render in several modes (full color, accented, clear, vibrant,
  luminance-reduced, StandBy night). Status must never rely on color alone.
- The notification permission prompt appears once. Ask in context.
- Keychain items survive app deletion; app containers do not.
- Symbolication needs dSYMs for the app, every extension, and the Rust library.
  Keep every archive.
- Logs reach sysdiagnose; keep personal values private in `os.Logger`.
- Open source: contributors build with their own team through a gitignored
  `Local.xcconfig`. Team IDs are public; keys, certificates, and profiles are
  not.

### 17.4 Two weeks of first steps

1. Start the D-U-N-S lookup and membership upgrade; ask Apple about the team ID;
   turn on auto-renew.
2. Record the Section 14 decisions.
3. Start trademark clearance; choose the App Store name and Home Screen name.
4. Install Xcode 27; get the test iPhones and watches; enable Developer Mode.
5. Add the `.gitignore` entries and a secret scan; move desktop signing files
   out of the repository.
6. Close the AI-disclosure correction in Ticket 187.
7. Resolve the completion-chime provenance; delete the two YouTube rips.
8. Create the four-target shell from templates with the xcconfig includes; run
   it on the devices.
9. Run Ticket 189a/b with the dedicated executor and the second VM.
10. Upload the first internal TestFlight build once the team is confirmed.

## 18. Review log

| Review | Main changes adopted |
|---|---|
| Architecture | Measured no-JIT costs; sync moved off the device engine; React Native dropped as fallback; D-lite fallback; locale bug; polyfill inventory corrected; store extraction details |
| Apple platform | Locked-device inactivity; before-first-unlock failure; same-device restore; watch notification routing; Controls on watch; 64-notification evidence; reload budget caveats; 4.8 wording |
| App Store compliance | AI disclosure, 18+ override, membership, reviewer access, deletion details, privacy label and manifests, audio provenance, name collision, storefronts |
| Data and sync | Command contract; `history_branch` conflicts; uniqueness pre-pass; sync journal; restore detection; version skew; per-device reminders; read-model contents |
| Delivery and tooling | Milestones with early TestFlight; stricter Ticket 189; prerequisites; build stamp outside Xcode; registry schema details; tooling decisions; iOS 27 minimum |
| Expert iOS pass | Intents in a shared package; portability in a second VM instead of a v1.0 `WKWebView`; membership first; watch app as v1.0.x; per-Behavior Controls; time formatting; accessibility specifics; MetricKit; release operations |
