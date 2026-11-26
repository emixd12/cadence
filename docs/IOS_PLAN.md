# Cadence iOS & Mac App Store Blueprint

Covers the iPhone app, the Apple Watch app and the Mac App Store listing.

- **Status:** Running blueprint. Not authorized for implementation. No iOS code, real
  ticket or ticket number exists. Mobile and Mac App Store work stay out of scope in
  `AGENTS.md` until the owner activates the track.
- **Synced through:** `64b78b80` (`origin/main`, November 25, 2026).
- **Refresh schedule:** Every other day via `.claude/skills/ios-plan-sync/SKILL.md`
  (Claude Opus 5.5 High).

This blueprint follows web development so that when the web app is ready and the owner
says "go", iPhone implementation starts with almost no stop-and-decide friction. Routine
refreshes edit only `docs/IOS_PLAN.md` and `docs/ios-plan/*.md`, never block web tickets
or deploys, and use plan-local `IOS-` step IDs (not real ticket numbers).

---

## 1. Blueprint Modules

| Module | What it covers |
|---|---|
| [01-port-map.md](ios-plan/01-port-map.md) | 1:1 mobile-web screen and flow port map (all 5 tabs, Onboarding/Login, every web feature through Nov 25, 2026), SwiftUI idioms, iPhone width sizing, standing port rules and co-development transition |
| [02-iphone-native.md](ios-plan/02-iphone-native.md) | Pre-packaged v1.0 iPhone-only features: active-timer & default-on upcoming Live Activities (with Completed/Not Completed + Routine card), full Siri/Shortcuts/Spotlight, Widgets & Controls (Mac sharing off), Notifications & When-In-Use Location, plus the Future iPhone-Specific Roadmap |
| [03-apple-watch.md](ios-plan/03-apple-watch.md) | What Watch gets automatically in v1.0 (mirrored notifications, Live Activities, iPhone Controls) and the v1.1 dedicated Watch app (Today, Needs decision, offline Completed/Not Completed, Timer, **voice-dictated quick Notes**, Complications, Smart Stack) |
| [04-accounts-sync-offline.md](ios-plan/04-accounts-sync-offline.md) | Sign-in required on first launch + full offline non-AI tracking once signed in, Apple/Google/Email sign-in, shared TS core + Rust SQLite store, CloudKit/SwiftData evaluation gate, incremental sync-path architecture, command contract, in-app deletion and performance budgets |
| [05-mac-app-store.md](ios-plan/05-mac-app-store.md) | Dual Mac distribution (Mac App Store as primary website install + notarized direct DMG on GitHub), single-codebase sandboxed MAS build variant, updater removal, and App Store compliance |
| [06-app-store-readiness.md](ios-plan/06-app-store-readiness.md) | Non-code pre-launch checklist: Developer Organization upgrade (Identity Scaffolding LLC / D-U-N-S), App Store title + subtitle & trademark clearance, 18+ age rating & state age signals, US-first v1.0 launch, unified AI consent ("not medical advice"), Privacy Label & Manifests, audio provenance, reviewer sign-in, test hardware |
| [07-build-phases.md](ios-plan/07-build-phases.md) | Redrawn build phases and ready-to-mint `IOS-` ticket blueprint (accounts + Live Activities + Siri in v1.0; Watch in v1.1; parallel MAS track), verification strategy, 23 required acceptance scenarios, preserved Claims Ledger, Expert Pass checklist, Review Log and activation steps |

---

## 2. Owner's Guiding Principles & Locked Product Decisions

Recorded November 18 and November 25, 2026 (`docs/DECISIONS.md`):

1. **Owner-triggered start:** iOS work starts when the web app is ready, on the owner's
   instruction. No fixed feature checklist gates activation.
2. **Full web parity, 1:1 flows:** Every web addition reaches iPhone. Screens, navigation
   (Timeline, Chat, Behaviors, Export & Import, Settings) and flows mirror mobile web 1:1
   in native SwiftUI idioms, sized cleanly across compact, standard and Pro Max iPhones.
3. **Accounts required + full offline tracking (v1.0):** Sign-in is required on first
   launch (no anonymous pre-sign-in mode), and once signed in all non-AI tracking features
   work fully offline and sync automatically on reconnect (like a linked Mac).
4. **Rich iPhone-native surfaces in v1.0:** Actionable notifications, Home/Lock Screen
   Widgets & Controls (with iPhone widgets disabled on Mac desktops), active-timer AND
   default-on upcoming/due Behavior Live Activities (Completed/Not Completed buttons,
   global + per-Behavior clutter controls, Routine single-card + expand), full Siri,
   Shortcuts & Spotlight (including Daily Brief summary), and When-In-Use location only.
5. **Apple Watch as a distinct v1.1 fast-follow:** v1.0 gives Watch users mirrored
   notifications, Live Activities in the Smart Stack and iPhone Controls for free; v1.1
   ships the dedicated Watch app (Today, Needs decision, offline marks, Timer,
   Complications, Smart Stack and voice-dictated quick Notes).
6. **Future iPhone-specific roadmap (post-v1):** Lightweight context-collection prompts in
   Live Activities, deeper Siri + Cadence Agent / Apple Intelligence analysis, and
   optional always-on location / geofencing.
7. **Mac App Store alongside direct download (separate listings, shared Mac ID):** Keep
   both the Mac App Store (primary easy install on the website) and the notarized direct
   DMG (GitHub/power users), sharing **one Mac bundle ID** (`app.cadence.desktop`) so
   macOS treats them as the same app. Keep **separate App Store listings** for
   iPhone/Watch (`app.cadence.ios`) and Mac (`app.cadence.desktop`)—not Universal
   Purchase—so ratings and reviews stay scoped per platform.
8. **Store & compliance posture:** Organization Developer account (Identity Scaffolding
   LLC via D-U-N-S, unless Apple allows a non-legal org named "Cadence"); distinctive App
   Store title + subtitle after trademark check ("Cadence" under Home Screen icon); 18+
   age rating override + state age signals; US-first v1.0 launch (China mainland
   excluded; EU/global after legal/GDPR pass); unified AI approval covering all Behaviors
   including Medical/Measurements with a "not medical advice" disclaimer.
9. **Platform-fit architecture:** Technical choices (shared TS core, Rust SQLite vs.
   CloudKit/SwiftData evaluation, incremental sync path, OS minimums, background refresh,
   CI) stay engineering-owned and adapt to Apple's platform constraints.
10. **Downstream until activation:** Never slows down or blocks web work. At activation,
    the workflow shifts to real-time co-development with web remaining primary.

---

## 3. Standing Web-to-iPhone Port Rules

These rules keep every-other-day refreshes automatic and low-noise:

- **Auto-port without asking:** Routine web additions—new Behavior fields, Timeline row
  details or actions, Settings options, shared `@cadence/core` resolvers, Advisor/Chat
  capabilities, hosted connector reads, or Mac sync contract / SQLite schema bumps—are
  folded directly into the relevant `docs/ios-plan/*.md` files using mobile-web 1:1
  parity.
- **Log an Open Question only when:** a merged web change creates a genuine product choice
  on an **iOS-only surface** (Live Activities, Widgets, Controls, Siri/Shortcuts/Spotlight,
  Apple Watch, Notifications, Location permissions) or affects **App Store / Mac App Store
  compliance** (privacy label, age rating, AI consent, auth, sandbox).

---

## 4. Open Questions Inbox

**Current open product questions: 0.** All 19 prior open decisions from the October/November
18 plan—plus the two Mac/iOS App Store identifier questions (Q1: separate iPhone/Watch
`app.cadence.ios` and Mac `app.cadence.desktop` listings; Q2: one shared
`app.cadence.desktop` bundle ID across both Mac channels)—were resolved on November 25,
2026 (`docs/DECISIONS.md`) or assigned to engineering evaluation at activation (`IOS-189`).

Non-code owner action items that can be started anytime before activation (not blocking
planning) are tracked in [06-app-store-readiness.md](ios-plan/06-app-store-readiness.md):
D-U-N-S / Organization upgrade, App Store subtitle & trademark check, audio asset rights,
and test hardware.

*(Future `ios-plan-sync` runs append new product questions here only when triggered by
Section 3.)*

---

## 5. Parity Snapshot

Source: `interaction-registry.json`, updated `2026-11-21`. Total interaction intents:
**232** (up from 194 on 2026-11-13). Mobile status: **187 deferred**, **45 not
applicable**, **0 implemented**.

| Surface | Deferred (iOS target) | Not applicable |
|---|---|---|
| Timeline | 43 | 11 |
| Behaviors | 47 | 1 |
| Settings | 42 | 27 |
| Export and import | 20 | 0 |
| Marketing | 11 | 2 |
| App shell | 9 | 1 |
| Chat | 5 | 0 |
| Login | 4 | 0 |
| Public legal | 3 | 0 |
| Onboarding | 2 | 0 |
| Development login | 1 | 0 |
| OAuth consent | 0 | 3 |
| **Total** | **187** | **45** |

---

## 6. Prerequisite Tracker

Web work is never asked to close an iOS prerequisite; refreshes record progress when web
or Mac work closes one naturally.

| Prerequisite | State (2026-11-25) | Evidence |
|---|---|---|
| Xcode 27 | Done | `xcodebuild -version`: 27.2 on owner's Mac (checked Nov 18; simulator runtimes not rechecked) |
| CI exists for a later iOS job | Done | `.github/workflows/ci.yml` + 4 workflows (`merge_group` ready) |
| Sign in with Apple on web | Done | D31; live Nov 13, 2026 |
| Sign in with Apple on Mac | Done (published) | Shipped in Cadence for Mac 0.1.11 (Nov 14); Ticket 337 Apple-linking check remains open |
| Native Sign in with Apple (iOS) | Open | Planned for v1.0 (`IOS-203`) |
| Apple token revocation | Partly | `lib/services/apple-sign-in.service.ts` + migration `20261113200000` exist; not reviewed against iOS deletion flow |
| Public AI disclosure | Appears done | `apps/marketing/src/data/routes.ts` names OpenAI; full pre-launch messaging pass in Ticket 246 |
| Command contract (`expectedStatus` / `expectedNote` / `commandId`) | Partly | `occurrence.service.ts` accepts `expectedStatus` and `expectedLatestEventId`, and `packages/core/src/data-store.ts:111–125` already supports `expectedNote`; `commandId` replay is pending (`IOS-190c`) |
| Code-point comparisons in core | Open | **102** `localeCompare`/`toLocaleLowerCase` uses in `packages/core/src` (was 83 on Nov 18, 66 in Oct) |
| Locale-aware time display | Open | `formatClockTimeLabel` still in `packages/core/src/services/schedule.ts` |
| `history_branch` as reviewable conflict | Open | `packages/core/src/resolvers/account-sync.resolver.ts:1000–1002` still throws "branched status history" |
| Temporal polyfill on native BigInt | Not rechecked | Recheck in `IOS-189a` |
| Shared store crate and C FFI | Open | No `crates/` directory; no `rust-toolchain.toml` (Mac SQLite now at schema 28, sync contract 9) |
| `packages/local-runtime` | Open | `packages/` holds `core` and `ui` only |
| `.gitignore` Xcode & signing patterns | Open | None of the Xcode/signing patterns are in `.gitignore` |
| Desktop signing files out of repo | Open | Two untracked files remain in `apps/desktop/signing/` in owner's checkout |
| Completion-chime provenance | Open | No record; two untracked Xbox sound files remain in `public/sounds/` in owner's checkout |
| Calendar identity decoupling | Open / needs review | `same_account_required` still enforced in `lib/services/google-calendar-oauth.ts:60`; D31 linking may cover Apple users once verified |
| Organization membership & D-U-N-S | Unknown | No record on `main`; owner approved upgrade (see `06-app-store-readiness.md`) |
| App Store title/subtitle & trademark | Unknown | Owner approved scoping subtitle + clearance (see `06-app-store-readiness.md`) |
| Test hardware (iPhones & Watches) | Unknown | No record on `main` (see `06-app-store-readiness.md`) |
| App Store Connect API key | Partly | D29.4 created one for notarization; Developer-role reuse for iOS/MAS not checked |
| Age rating (18+) & state age signals | Open | Planned for v1.0 (`IOS-209`) |

---

## 7. Claims to Recheck at Activation

Technical platform claims in [07-build-phases.md](ios-plan/07-build-phases.md) ("Claims
ledger") and [04-accounts-sync-offline.md](ios-plan/04-accounts-sync-offline.md) rest on
Apple documentation and M5 measurements from October 15, 2026. Routine syncs do not
re-read Apple docs. Recheck these at activation:

- Every row of the Claims Ledger in [07-build-phases.md](ios-plan/07-build-phases.md)
  (especially iOS 27 / watchOS 27 APIs, APNs Live Activity push-to-start, and device support).
- App Store Review Guidelines 4.8, 5.1.1(v), 5.1.2(i), Mac App Sandbox rules, and state
  age-assurance laws (Utah, Louisiana, Texas).
- No-JIT performance measurements on real iPhone hardware (iPhone SE 2nd gen / iPhone 11).
- App Store name search and trademark availability for the chosen title + subtitle.

---

## 8. Sync Log

| Date | Synced through | Changes |
|---|---|---|
| 2026-11-25 | `64b78b80` | **Modular blueprint launch (Owner planning pass, Rounds 1–3).** Replaced single-file October baseline with this hub + 7 focused modules under `docs/ios-plan/`. Folded in all web features merged Nov 18–25 (Advisor Coach/Chat/Avatar/Speech Pill, Routines & Semantic Zoom, Opportunity Basket, Alongside Behaviors D33, Ended/Paused Behaviors, Auto-stop Timer, Note Shortcuts revamp & Auto-save Closure, Geoapify Place Search, Persisted Connector Activity). Redrew v1.0 around accounts + offline tracking + Live Activities (Completed/Not Completed) + full Siri/Shortcuts/Spotlight, v1.1 around Watch (with voice Notes), dual Mac App Store + DMG distribution, US-first 18+ launch, and every-other-day refresh cadence. Recounted registry (232 intents; 187 deferred) and prerequisites (`localeCompare` now 102). |
| 2026-11-18 | `1f80c1c3` | Owner answers recorded: accounts in the first release, CloudKit and SwiftData to be evaluated, every web addition in iOS scope, Mac App Store listing joins the plan, activation on owner's instruction with no feature list. Cursor unchanged. |
| 2026-11-18 | `1f80c1c3` | Restored October 15 proposal from tag `archive/advisor-analysis-wip-2026-10-22` (`985b6862`). Renamed proposed ticket numbers 188–211 to plan-local `IOS-` IDs. Added Part A. Corrected ten stale lines in Part B. |
