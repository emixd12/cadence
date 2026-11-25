# 07. Build phases, step blueprint, verification and reference ledger

Part of the running iOS blueprint. The hub is `docs/IOS_PLAN.md`. This file is
not a source-of-truth document and authorizes nothing. No iOS, watchOS or Mac
App Store code, target, ticket or ticket number exists. Mobile and Mac App Store
work stay out of scope in `AGENTS.md` until the owner activates the track
(`docs/DECISIONS.md`, 2026-11-18 and 2026-11-25).

**Step IDs are plan-local.** `IOS-188` through `IOS-211` and `IOS-MAS-1` through
`IOS-MAS-3` are not ticket numbers. Do not cite them in tickets or code. Real
ticket numbers are allocated at activation with `npm run ids:next`.

Baseline: the October 15, 2026 proposal (`docs/IOS_PLAN.md` at `64b78b80`,
Part B, Sections 9–12 and 15–18), redrawn for the owner decisions of November
18 and November 25, 2026.

## 1. What changed from the October order

The October order shipped a local-only v1.0, then a v1.0.x with the watch app,
Siri and Spotlight, then v1.1 accounts. It is superseded.

| Area | October 15 | Now |
|---|---|---|
| Accounts, sign-in, sync | v1.1 | v1.0; sign-in required on first launch (November 18 and 25) |
| Offline tracking | v1.0 local-only | v1.0 offline once signed in, syncing on reconnect |
| Live Activities | Timing activity in v1.0; opt-in upcoming activity in v1.0.x | v1.0: timer activity plus default-on upcoming and due Behavior activities with Completed and Not Completed |
| Siri, Shortcuts, Spotlight | Core intents v1.0; Siri and Spotlight v1.0.x | Full set in v1.0, with Undo and a spoken Daily Brief summary |
| Daily Brief, Chat, connectors, Travel | v1.1 or undecided | v1.0, full web parity |
| Apple Watch app | v1.0.x | v1.1 fast follow |
| Mac App Store | Not covered | Parallel track, both channels kept |
| Storefronts | Consider US-first | US-first v1.0, 18+ |

Old step IDs that moved:

| October step | Now |
|---|---|
| `IOS-199` timing activity and Controls | `IOS-199a`, `IOS-199c` |
| `IOS-200a` core intents; `IOS-200b` Siri and Spotlight | `IOS-200` |
| `IOS-202a` Apple sign-in on web and desktop | Done on web (D31) and Mac 0.1.11 |
| `IOS-202b` deletion API and revocation | `IOS-190f` |
| `IOS-202c` Universal Links; `IOS-202d` relay email | `IOS-188a` (portal), `IOS-203` (app) |
| `IOS-202e` legal copy | Messaging track; checked in `IOS-209` |
| `IOS-202f` Calendar identity | `IOS-205` |
| `IOS-202g` sync hardening | `IOS-190e` |
| `IOS-202h` sync path | `IOS-189b` decision, `IOS-190f` build |
| `IOS-204` link, sync, conflicts, disconnect, deletion | `IOS-192`, `IOS-203`, `IOS-196` |
| M3–M8 | Renumbered below |

## 2. Milestones and steps

Sizes count agent sessions: **S** ≤ 3, **M** 4–10, **L** 10–25, **XL** > 25 or
repeated Apple reviews. No calendar estimate is credible yet. Every milestone
ends with a TestFlight build and dated device evidence. External TestFlight
starts in M2.

### M0 Ready and activation

| Step | Contents | Depends on | Size |
|---|---|---|---|
| `IOS-188` | Activation: amend `AGENTS.md` scope lines (mobile, native Sign in with Apple), `docs/PRODUCT_SPEC.md`, `docs/PUBLIC_PRODUCT_ARCHITECTURE.md`; registry schema 1.4.0 (native surfaces may omit `routes`, optional `entry_points` on the `mobile` record for `INT-TIMELINE-002/005/006/008/009` and `INT-NOTIFICATION-001`, `additionalProperties: false` kept); `scripts/check-interactions.mjs` scans Swift and gains `--mobile-release <milestone>`; reclassify `INT-AUTH-*` as applicable in v1.0, `INT-DESKTOP-002` per channel, Daily Brief and Travel as deferred | Owner says "go" | S |
| `IOS-188a` | Organization membership, identifiers, portal and App Store Connect setup, API key, repository hygiene (`.gitignore`, secret scan, signing files out); `rust-toolchain.toml` with `aarch64-apple-ios` and `aarch64-apple-ios-sim`; owner creates the four-target Xcode shell from templates with `Config/Base.xcconfig` and gitignored `Local.xcconfig`; first internal TestFlight build | `06-app-store-readiness.md` items 1, 6.2, 6.5, 8 | M |

Exit: owner decisions recorded; membership settled and team ID confirmed;
four-target shell processed in TestFlight and installed on a phone and a watch.

### M1 Architecture, engine and storage gate

| Step | Contents | Depends on | Size |
|---|---|---|---|
| `IOS-189a` | Simulator spike: tracking engine in `JSContext` on a dedicated serial executor, portability engine in a second `JSVirtualMachine`; Temporal polyfill on native BigInt; native SHA-256 host function. Evaluate SwiftData and CloudKit against the Rust SQLite store plus Supabase sync (decided November 18, 2026; CloudKit cannot serve web users, so it would be a second sync system) | M0 | M |
| `IOS-189b` | Real-device budget run on iPhone SE (2nd gen) and iPhone 11 (Section 3); freeze the sync-path decision (incremental sync, or the snapshot planner in a hidden `WKWebView`); freeze the read-model and command schemas as generated Swift types | `IOS-189a`, test hardware | M (XL on fallback) |

Exit: Section 3 budgets PASS or a fallback is decided with the owner; storage
choice and sync path frozen; independent review of the gate.

### P Cross-platform prerequisites

Web and desktop changes that iOS needs. Each lands as ordinary web or Mac work
with its own tickets after activation.

| Step | Contents | Depends on | Size |
|---|---|---|---|
| `IOS-190a` | Code-point or explicit-locale comparisons in core (102 `localeCompare`/`toLocaleLowerCase` uses on November 25, 2026; Lithuanian reorders titles and changes restore fingerprints); Temporal on native BigInt; locale-aware time display and a host time formatter for notification text (`formatClockTimeLabel` hard-codes 12-hour English) | M1 | M |
| `IOS-190b` | Typed Behavior validation in core (move `parseBehaviorFormData` limits out of `lib/services/behavior-form.ts`) | M1 | S |
| `IOS-190c` | Command contract: `commandId` replay from retained outbox rows, `expectedStatus`, `expectedLatestEventId`, `expectedSessionId`, and `expectedNote` for Note writes; `applyOccurrenceStatusTransition` honors the caller's expectation | M1 | M |
| `IOS-190d` | `crates/cadence-local-store` and `crates/cadence-local-store-ffi` (`open`, `invoke(json) -> json`, `close`, `free`; `catch_unwind`; static XCFramework for device, simulator and macOS); move `auth.rs` account metadata, first-link and sync-completion transactions and `files.rs` disconnect and backup into the crate; replace `/bin/df` in `recovery.rs` (also `IOS-MAS-1`); one migration chain, CI compares hashes | M1 | L |
| `IOS-190e` | `packages/local-runtime` with `SyncCoordinator` out of React; persisted sync journal; `history_branch` as a reviewable conflict (today `account-sync.resolver.ts` throws "branched status history"); uniqueness pre-pass (same-slot Occurrences, two running sessions) | `IOS-190d` | L |
| `IOS-190f` | Incremental sync backend and contract if M1 selects it; APNs Live Activity push-to-start and update endpoint; deletion API with bearer auth, Apple token revocation parity (L-025), Sign in with Apple server notifications, Sequenzy subscriber deletion; desktop terminal "account deleted" state | M1 decision | L (XL with incremental sync) |

Exit: web and desktop suites pass, native tests pass, installed desktop smoke
passes on the Mac (`.claude/skills/desktop-acceptance`).

### M2 Accounts, offline engine and daily loop

| Step | Contents | Depends on | Size |
|---|---|---|---|
| `IOS-192` | Engine packaging (`npm run ios:prepare` builds the bundle, XCFramework, generated contracts and tokens outside Xcode; Xcode checks a stamp file); `ReadModelWriter` (atomic JSON in the App Group); offline store; foreground sync coordinator; restore detection; "Update Cadence" mode | P | L |
| `IOS-193` | Five-tab SwiftUI shell (Timeline, Chat, Behaviors, Export & Import, Settings); generated `CadenceTokens.swift` from `packages/ui/tokens.css`; compact, standard and Pro Max widths; Dynamic Type | `IOS-192` | M |
| `IOS-203` | Native Sign in with Apple (hashed nonce to Apple, raw nonce to `signInWithIdToken`), Google (PKCE in `ASWebAuthenticationSession`, `Callback.https` with an associated domain), email 6-digit code; Apple credential-state check and revocation observer; onboarding; first-launch sign-in required | `IOS-190f` | M |
| `IOS-194a` | Timeline: statuses, Needs decision, collapsed auto-save Notes with inline shortcuts, Routines and Semantic Zoom, Opportunity Basket, Alongside | `IOS-193` | L |
| `IOS-194b` | Time tracking, auto-stop on Completed, inline duration | `IOS-194a` | M |
| `IOS-195a` | Behavior create and edit, Routines, Opportunity, Alongside, Geoapify place autocomplete | `IOS-193`, `IOS-190b` | M |
| `IOS-197` | Actionable notifications (Completed, Not Completed, Add Note); 64-pending horizon with reserve, readback and visible coverage; per-device "Reminders on this device" toggle | `IOS-192` | M |

Exit: 7–14 days of real-device dogfooding across midnight; locked-phone actions;
reminder readback; offline marks converge on reconnect; external TestFlight Beta
App Review approved.

During P, build the SwiftUI shell, widgets and notification handling against
frozen fixture JSON.

### M3 v1.0 iPhone-native surfaces

| Step | Contents | Depends on | Size |
|---|---|---|---|
| `IOS-198` | Home and Lock Screen widgets (small, medium interactive, Lock Screen rectangular and inline); iPhone widgets on the Mac desktop disabled | `IOS-192` | M |
| `IOS-199a` | Active timer Live Activity: elapsed time, Stop and Complete (`LiveActivityIntent` names its session); ends at 8 hours while the session continues | `IOS-194b` | M |
| `IOS-199b` | Default-on upcoming and due Behavior Live Activities with Completed and Not Completed; Routine as one card with "Complete routine" and expand; global Settings switch and per-Behavior toggle; scheduled starts and APNs push-to-start | `IOS-190f`, `IOS-199a` | L |
| `IOS-199c` | Controls in Control Center, Lock Screen and the Action button: per-Behavior "Complete", "Start or stop timing"; Controls on Apple Watch through the iPhone | `IOS-192` | M |
| `IOS-200` | Full Siri and App Shortcuts (app name in every phrase): mark Completed and Not Completed with Undo, Behavior and day Notes, start and stop timer, Opportunity Basket add and done, Today and Needs decision queries, spoken read-only Daily Brief summary; Spotlight indexing with a Settings opt-out that clears the index | `IOS-192` | M |

Exit: Dynamic Island, Action button, Controls on the watch and locked-device
behavior checked on hardware; App Intents Testing passes.

### M4 v1.0 full web parity

| Step | Contents | Depends on | Size |
|---|---|---|---|
| `IOS-195b` | Archive, Ended and Paused Behaviors, category CRUD and drag-reorder | `IOS-195a` | M |
| `IOS-195c` | Analytics and selected-day review | `IOS-193` | M |
| `IOS-205` | Hosted connectors: Google, Outlook and iCloud Calendar; Hevy source links and connector-completion labels; Travel advisory with When In Use location and leave reminders; Calendar identity and Google verification gates | M2 | L |
| `IOS-206` | Advisor: animated 60 pt horse and speech pill; Daily Brief moves, recheck and Undo; Coach tips and schedule proposals; Chat tab; unified AI consent sheet | M2 | L |
| `IOS-196` | Four-group auto-save Settings; Connected apps (MCP) view; Sign-in methods; in-app account deletion | `IOS-203`, `IOS-190f` | M |
| `IOS-208` | Export in five formats and BehaviorLog import and restore in the portability engine, with progress, cancel and `BGContinuedProcessingTask` | `IOS-192` | M |

Exit: every deferred mobile intent in `interaction-registry.json` for v1.0 has
evidence (`--mobile-release v1.0`); milestone release check passes.

### M5 v1.0 App Store release (US-first, 18+)

| Step | Contents | Depends on | Size |
|---|---|---|---|
| `IOS-209` | Compliance: privacy manifests, 18+ override and age signals, App Privacy label, acknowledgements, audio provenance, title and subtitle, reviewer account and recordings, Privacy Policy and Support URLs (`06-app-store-readiness.md`) | M4 | M |
| `IOS-211` | Release manifest, App Review, manual v1.0 release in the United States | `IOS-209` | M (XL with repeated reviews) |

Exit: App Store install on a clean device passes the release check.

### M6 v1.1 Apple Watch app (fast follow)

| Step | Contents | Depends on | Size |
|---|---|---|---|
| `IOS-201a` | Paired-hardware proof: WatchConnectivity, `transferUserInfo` retry, `updateApplicationContext` versus `transferCurrentComplicationUserInfo`, watchOS 26 with iOS 27 pairing | M5 | S |
| `IOS-201b` | Watch app: Today, Needs decision, offline Completed and Not Completed queue, timer, voice-dictated quick Notes | `IOS-201a` | L |
| `IOS-201c` | Complications and RelevanceKit Smart Stack cards | `IOS-201b` | M |
| `IOS-201d` | Watch notifications, Double Tap, watch App Store metadata and screenshots | `IOS-201b` | S |

Exit: paired matrix on watchOS 26 and 27. Design lives in `03-apple-watch.md`.

### MAS Mac App Store track

Runs beside M4 and M5, or right after the v1.0 launch. Design lives in
`05-mac-app-store.md`.

| Step | Contents | Depends on | Size |
|---|---|---|---|
| `IOS-MAS-1` | Sandbox entitlements and updater removal in a `mas` build variant | `IOS-188a` | M |
| `IOS-MAS-2` | 4.8, 5.1.1(v), privacy manifest, 18+, dual-channel release pipeline keeping the direct DMG | `IOS-MAS-1`, `IOS-190f` | M |
| `IOS-MAS-3` | Mac TestFlight, App Review, store launch | `IOS-MAS-2` | M |

### Critical path and concurrency

Critical path: M0 → M1 → P → M2 → M3 → M4 → M5. M3 and M4 overlap once M2
exits. M6 follows M5. MAS runs in parallel after M0.

Start owner decisions that gate later work in M0: linking policy for Apple and
Google identities, age policy, trader status for later storefronts, Universal
Purchase.

One change at a time for `packages/core`, `interaction-registry.json`,
`project.pbxproj` and `STATUS.md`/`docs/TICKETS.md`. One agent per milestone
edits the registry.

## 3. Budgets and decision rule (M1)

Fix targets before measuring. Run 20 cold launches and 100 writes per device in
Release builds. Record device, OS build, thermal state and bundle hash. If a
metric stays above twice its target after one optimization pass, decide the
fallback with the owner. `04-accounts-sync-offline.md` holds the architecture
these budgets test.

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

Fallback: tracking misses → D-lite, a Swift port of the tracking slice (about
3–4k lines), which needs an `AGENTS.md` policy change. Portability misses → a
heavy-job `WKWebView` evaluation or algorithm work. Sync stays out of the no-JIT
engine in every case.

## 4. Tooling and agentic workflow

| Decision | Tools |
|---|---|
| Adopt | Repo scripts (`ios:prepare`, `ios:test:*`, `ios:verify`) as the only agent and CI interface; Claude simulator tools (simulator only); Xcode 27 `mcpbridge` and Device Hub after an M0 comparison; one pinned skill per category (Hudson SwiftUI Pro and Swift Testing Pro, van der Lee Swift Concurrency); swift-snapshot-testing; App Intents Testing; XCTMetric |
| Optional | XcodeBuildMCP (pinned, telemetry off); OpenAI's Build iOS Apps plugin and serve-sim for Codex; `asc` CLI for read-only status (writes need owner approval); Greenlight static scan before submission (a clean scan is not approval) |
| Defer | Xcode Cloud (Node and Rust installs per build consume included hours); a path-filtered, unsigned `xcode-27` GitHub job after M2 (never `pull_request_target`) |
| Avoid | MobAI (paid, unverified claims); Revyl runtime runs (upload the app binary) |
| Owner-run | Icon Composer; developer portal and App Store Connect writes; first code-signing prompt; first upload |

Rules:

- Agents edit `Package.swift`, not `project.pbxproj`. No XcodeGen or Tuist.
- Agents never pass `-allowProvisioningUpdates` or change signing without owner
  approval.
- App Store Connect and Sign in with Apple `.p8` keys never enter git or an
  agent prompt.
- Simulators and devices are driven through the T3 device tools
  (`device_list`, `device_open`), per this environment's rules.

## 5. Verification strategy

- **Engine conformance.** Shared fixtures run through Node and both `JSContext`
  VMs and match byte for byte, including DST, monthly fallback, fingerprints and
  import plans, under en, da, tr, et, lt, th-TH, ja-JP with the Japanese
  calendar, ar, and 24-hour time.
- **Rust store.** Cargo tests plus Swift FFI tests on simulator and device.
- **Swift.** Swift Testing; snapshot tests pinned to one simulator, OS and
  Xcode, including an AX5 text-size snapshot at the SE width; at most five
  XCUITest journeys with `performAccessibilityAudit()`; App Intents Testing;
  XCTMetric on devices.
- **Accessibility.** Each Occurrence is one VoiceOver element ("Behavior, time,
  status") with custom actions. Day headers and Needs decision are headers.
  Status changes are announced. Actions stack with `ViewThatFits` at
  accessibility sizes. Voice Control labels match visible names.
- **Manual on hardware.** StandBy, Dynamic Island, locked-device actions, watch
  transfers, first unlock after reboot, storage full, Low Power Mode.
- **Dogfooding.** Each milestone runs 7–14 days across midnight. The first real
  daylight-saving change after activation is likely March 14, 2027; test DST
  earlier with timezone fixtures.
- **Evidence states.** PASS, FAIL, UNVERIFIED, N/A. A build is not release-ready
  while any required item is FAIL or UNVERIFIED.
- **Parity.** `npm run interactions:check -- --mobile-release <milestone>`
  checks that milestone's intents only.

## 6. Required acceptance scenarios

Scenarios 1–18 are B 10.1. Scenarios 14–18 were v1.1 in October; they are v1.0
now because accounts ship in v1.0. Scenarios 19–23 are new.

1. Force quit, then each entry point: widget, Control, notification, Live
   Activity, Siri, watch.
2. Notification action on a locked phone after first unlock; before first
   unlock (fails visibly, never claims success).
3. Widget button with Live Activities disabled.
4. Watch reply lost, then a `transferUserInfo` retry: exactly one event.
5. Queued watch tap applied after midnight: completion time equals tap time;
   repeat with the watch clock ±2 minutes.
6. First background launch after an update with a pending migration plus a
   notification action: rejected visibly.
7. TestFlight N+1 to N with a newer schema: fails closed ("Update Cadence").
8. iPhone N+1 with watch N, and the reverse.
9. Delete and reinstall with a surviving Keychain item.
10. iCloud restore to a new device; same-device restore of an older backup.
11. Lock Screen redaction toggled: reminder coverage stays complete.
12. Widget tap on a stale read model: rejected, then reloaded.
13. Storage full during a notification action: visible failure, no corruption.
14. Offline Lock Screen Not Completed against web Completed → reviewable
    conflict; other entities still sync.
15. iPhone offline 3 days while web or desktop extends the horizon → no
    uniqueness violation.
16. Kill after the hosted commit, then edit a pushed entity → converges.
17. Account deleted on iOS while a desktop syncs → desktop terminal state.
18. Hosted synced-field change before the iOS update → "Update required".
19. Signed in, offline for a day: mark statuses, edit a Routine, add and finish
    Opportunity Basket items, auto-save Notes, run a timer that auto-stops on
    Completed. Reconnect: web and the Mac show the same state; no duplicate
    events; Note text intact.
20. Default-on upcoming Behavior Live Activity appears before its time; Completed
    and Not Completed from the Lock Screen after unlock write once; turning the
    Behavior's toggle off stops its activities; the global switch stops all; a
    Routine card completes the routine and expands to steps.
21. Siri marks an Occurrence Completed, then Undo restores Unresolved; Siri reads
    the Daily Brief summary without applying moves; turning Spotlight off
    removes every indexed item.
22. Watch v1.1 offline: a voice-dictated Note is queued, then reconciled. If the
    Occurrence gained a Note elsewhere meanwhile, the queued Note is rejected by
    `expectedNote` and the person is told; no Note is overwritten.
23. Mac App Store build installs sandboxed; it never contacts the updater feed
    and shows no update UI; the direct DMG on the same account still updates
    through the Tauri updater; data moves between channels by the chosen method
    (`05-mac-app-store.md`, Section 7).

## 7. Claims ledger

Last verified **October 15, 2026**. Every row is rechecked at activation
(`docs/IOS_PLAN.md`, "Claims to recheck at activation").

| Claim | Status | Source | Recheck at activation |
|---|---|---|---|
| No-JIT sync and portability 9–18× slower | Measured on M5, not device | Architecture review; reproduced | Yes, on iPhone (`IOS-189b`) |
| Tracking fits with native BigInt | Measured on M5, not device | Same | Yes, on iPhone |
| `LiveActivityIntent` runs in app process | Verified | WidgetKit "Adding interactivity" | Yes |
| Locked-device buttons inactive | Verified | Same | Yes |
| Shared-package intents and `IntentExecutionTargets` (iOS 27) | Verified | AppIntents DocC | Yes |
| Scheduled Live Activity needs alert configuration | Verified | ActivityKit DocC | Yes |
| `BGContinuedProcessingTask` progress and cancel | Verified | BackgroundTasks article | Yes |
| `MetricManager` iOS 27; `MXMetricManager` deprecated 27.2 | Verified | MetricKit DocC | Yes |
| 64 pending notifications | Forum statement | Thread 811171 | Yes |
| WKWebView has JIT | Widely reported, undocumented | Relevant only if M1 picks the `WKWebView` sync path | Yes |
| watchOS 26 watch pairs with iOS 27 iPhone | Forum reports, no Apple document | `IOS-201a` | Yes |
| Age rating override required for 18+ Terms | Verified | App Store Connect Help | Yes |
| Utah/Louisiana age-signal dates | Verified | Apple notice, February 24, 2026 | Yes |
| Accessibility Nutrition Labels voluntary now | Verified | App Store Connect Help | Yes |
| Several "Cadence" apps on the App Store | Verified by listing search | Web search, October 15, 2026 | Yes |
| Organization upgrade timing | Apple D-U-N-S page plus forum reports | Ask Apple | Yes |
| `transferCurrentComplicationUserInfo` 50/day | Expert review, not rechecked | `IOS-201a` | Yes |
| iPhone widgets on Mac by default | Platform review citing WidgetKit docs | `IOS-198` | Yes |

Claims added November 25, 2026, not yet verified: APNs Live Activity
push-to-start for upcoming Behaviors (`IOS-199b`); Mac App Store guideline
2.4.5 and sandbox specifics (`05-mac-app-store.md`, Section 6).

## 8. Expert pass: what a first-time iOS developer should know

From B 17. Most items are also wired into the modules; this is the checklist view.

### 8.1 How an experienced developer would approach it

- Put real hardware in the loop from week one. Simulator evidence is functional
  evidence only.
- Much Apple Watch value comes from the iPhone app: mirrored actionable
  notifications, Live Activities in the Smart Stack and iPhone Controls on the
  watch. Ship those first; build the watch app as its own milestone.
- Start with few surfaces and add variants that dogfooding justifies.
- Design iOS screens natively. Keep semantic parity with web and desktop, not
  visual parity.
- Freeze the read-model and command schemas early, then build UI against fixture
  JSON while shared-code work proceeds.
- Use external TestFlight early: Beta App Review is a cheap guideline check.

### 8.2 Apple account and store operations

- The Account Holder alone accepts agreement updates; uploads stop until they
  do. A free app needs no paid-apps, tax or banking setup.
- Membership is annual; a lapse removes the app from sale. Turn on auto-renew.
- TestFlight: internal testers need no review; external testers need Beta App
  Review for a version's first build. Builds expire after 90 days.
- Review results arrive in App Store Connect. You can reply, resubmit, appeal or
  request expedited review. Include steps and a screen recording for system
  surfaces in review notes.
- Phased release applies to updates, not the first version; use manual release
  for v1.0. Promotional text changes without review; other metadata needs a
  submission.
- `requestReview` shows at most three times a year and does nothing in
  TestFlight. Prefer a Settings link to write a review.
- Apple raises the minimum SDK each spring and ships betas each June. Budget an
  annual SDK and OS adoption step.

### 8.3 Engineering realities

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
  explicit VoiceOver elements, headers, custom actions and announcements.
- Widgets render in several modes (full color, accented, clear, vibrant,
  luminance-reduced, StandBy night). Status must never rely on color alone.
- The notification permission prompt appears once. Ask in context.
- Keychain items survive app deletion; app containers do not.
- Symbolication needs dSYMs for the app, every extension and the Rust library.
  Keep every archive.
- Logs reach sysdiagnose; keep personal values private in `os.Logger`.
- Open source: contributors build with their own team through a gitignored
  `Local.xcconfig`. Team IDs are public; keys, certificates and profiles are
  not.

### 8.4 First two weeks after activation

1. Start the D-U-N-S lookup and membership upgrade; ask Apple about the team ID;
   turn on auto-renew. (Can start before activation: `06-app-store-readiness.md`.)
2. Record any remaining owner decisions in `docs/DECISIONS.md`.
3. Start trademark clearance; choose the App Store title, subtitle and Home
   Screen name.
4. Confirm Xcode 27 and simulator runtimes; get the test iPhones and watches;
   enable Developer Mode.
5. Add the `.gitignore` entries and a secret scan; move desktop signing files out
   of the repository.
6. Confirm the AI disclosure in Privacy, Terms and the processor table.
7. Resolve the completion-chime provenance; delete the two YouTube rips.
8. Create the four-target shell from templates with the xcconfig includes; run
   it on the devices.
9. Run `IOS-189a` and `IOS-189b` with the dedicated executor and the second VM.
10. Upload the first internal TestFlight build once the team is confirmed.

## 9. Risks and mitigations

1. **Device budgets miss.** D-lite with an `AGENTS.md` policy change, decided
   with the owner at the M1 gate.
2. **Extraction regresses desktop.** Strangler order; native and installed desktop
   checks after each P step; P lands as ordinary Mac releases.
3. **Sync on the v1.0 critical path.** No-JIT makes the snapshot planner about
   10× slower. M1 freezes the sync path before M2 starts; `IOS-190f` builds it.
4. **Offline divergence with accounts on day one.** Command contract,
   `history_branch` review, uniqueness pre-pass and sync journal land in P;
   scenarios 14–16 and 19 gate M2.
5. **App Review blockers at the first submission.** Reviewer sign-in, in-app
   deletion, AI consent and 18+ are all v1.0 duties now
   (`06-app-store-readiness.md`); external TestFlight in M2 surfaces them early.
6. **Default-on Live Activities feel like clutter or breach limits.** Global and
   per-Behavior toggles; simultaneous-activity and 8-hour limits tested in
   `IOS-199b`; scenario 20.
7. **APNs push-to-start adds hosted infrastructure.** Scheduled starts from the
   foreground remain the fallback; reminder notifications stay regardless.
8. **Name or trademark conflict.** Clearance before the record is created.
9. **Membership upgrade delays uploads or changes the team ID.** Do it first,
   outside Mac release windows; ask Apple in writing.
10. **Two Mac channels drift.** One codebase, a build-time channel switch,
    release checks that assert updater presence or absence; scenario 23.
11. **Mac App Store review rejects the hosted Apple sign-in or the sandbox.**
    The MAS track runs beside, not on, the iPhone critical path; native Sign in
    with Apple reuses `IOS-203`.
12. **Solo maintenance across web, two Mac channels, iPhone and watch.** Shared
    engine, generated contracts, milestone-scoped parity checks, and web stays
    primary.

## 10. Historical review log

From B 18. The October draft went through five adversarial reviews and an expert
iOS-developer pass.

| Review | Main changes adopted |
|---|---|
| Architecture | Measured no-JIT costs; sync moved off the device engine; React Native dropped as fallback; D-lite fallback; locale bug; polyfill inventory corrected; store extraction details |
| Apple platform | Locked-device inactivity; before-first-unlock failure; same-device restore; watch notification routing; Controls on watch; 64-notification evidence; reload budget caveats; 4.8 wording |
| App Store compliance | AI disclosure, 18+ override, membership, reviewer access, deletion details, privacy label and manifests, audio provenance, name collision, storefronts |
| Data and sync | Command contract; `history_branch` conflicts; uniqueness pre-pass; sync journal; restore detection; version skew; per-device reminders; read-model contents |
| Delivery and tooling | Milestones with early TestFlight; stricter budget gate; prerequisites; build stamp outside Xcode; registry schema details; tooling decisions; iOS 27 minimum |
| Expert iOS pass | Intents in a shared package; portability in a second VM instead of a v1.0 `WKWebView`; membership first; watch app as its own milestone; per-Behavior Controls; time formatting; accessibility specifics; MetricKit; release operations |
| Owner planning pass, November 25, 2026 | Accounts and offline in v1.0; default-on upcoming Live Activities; full Siri in v1.0; watch app in v1.1 with voice Notes; dual Mac distribution; US-first 18+; unified AI approval; this redrawn order |

## 11. Activation and the move to real-time co-development

Run in order when the owner says "go".

1. Run `npm run git:fresh`, then the `ios-plan-sync` skill once more so the
   blueprint is current with `origin/main`.
2. Recheck every claim in Section 7 and the hub's "Claims to recheck at
   activation": guidelines 4.8, 5.1.1(v), 5.1.2(i) and 2.4.5, age-assurance
   rules, iOS 27 and watchOS 27 APIs, the App Store name search. Update the
   modules with what changed.
3. Record the activation decision in `docs/DECISIONS.md`.
4. Allocate real ticket numbers with `npm run ids:next`, one per step here. Write
   each ticket in `docs/TICKETS.md` with its web, desktop, marketing and mobile
   impact and its messaging impact.
5. Amend `AGENTS.md` (scope lines for mobile, the Mac App Store and native Sign
   in with Apple; the "iOS running plan" section), `docs/PRODUCT_SPEC.md` and
   `docs/PUBLIC_PRODUCT_ARCHITECTURE.md` (`IOS-188`).
6. Update `STATUS.md` when the first ticket starts.
7. Stop the every-other-day `ios-plan-sync` refresh. From then on, a web change
   cascades in real time: web first, then the Mac, then the iPhone, each in its
   own tickets. Web stays the primary surface. Every web ticket's "Future
   mobile" line becomes a real iPhone follow-up ticket or a not-applicable
   reason.
8. The blueprint modules become reference. Tickets, `STATUS.md` and the
   source-of-truth documents take over.
