# 06. App Store and business readiness

Part of the running iOS blueprint. The hub is `docs/IOS_PLAN.md`. This file is
not a source-of-truth document and authorizes nothing. No iOS or Mac App Store
code, record, identifier, ticket or ticket number exists. Mobile and Mac App
Store work stay out of scope in `AGENTS.md` until the owner activates the track
(`docs/DECISIONS.md`, 2026-11-18 and 2026-11-25).

Step IDs such as `IOS-209` are plan-local. They are not ticket numbers. Real
ticket numbers are allocated at activation.

Baseline: the October 15, 2026 proposal (`docs/IOS_PLAN.md` at `64b78b80`,
Part B, Sections 7, 13 and 17.2), updated for the owner decisions of November
18 and November 25, 2026.

This is a non-code checklist. The owner can finish most of it before
activation. Nothing here blocks web or Mac work. Items marked **Owner** need the
owner's own accounts, money or signature. Items marked **Agent** an agent can
prepare. Every Apple rule cited here was read on October 15, 2026 and is
rechecked at activation (`07-build-phases.md`, "Claims ledger").

Changed since October: v1.0 has accounts (November 18). October's plan assumed a
local-only v1.0 that needed no login, deletion, AI consent or reviewer account
at first review. Those duties now apply to the first submission.

## 1. Apple Developer organization account

Decided November 25, 2026: upgrade from Individual to Organization before
registering any iPhone or Mac App Store identifier.

Why (B 7.1): an individual membership is not itself a guideline violation
(5.1.1(ix) targets regulated fields and required sensitive data). Upgrade
anyway. The LLC is the licensor and the Terms entity. An individual account
publishes the owner's name and, for EU sales, personal trader contact details.
Sign in with Apple user identifiers are scoped to the team.

Legal entity: Apple requires a registered legal entity with a D-U-N-S number for
an Organization account. **Identity Scaffolding LLC** is the concrete path. The
owner prefers "Cadence" as the organization name; that is possible only if
Apple ever accepts a non-legal organization name, which it does not today
(recheck at activation). The seller name and the App Store title are separate:
the title can still be Cadence-based (item 2).

- [ ] **Owner.** Confirm the LLC's exact legal name and address as registered
      with the state. D-U-N-S records must match it character for character.
- [ ] **Owner.** Look up or request the D-U-N-S number through Apple's D-U-N-S
      lookup. Apple allows about five business days at D&B plus about two for
      Apple to receive it.
- [ ] **Owner.** Ask Apple in writing whether team ID `HK26VT477G` survives the
      upgrade. It is in the Mac entitlements, the Keychain access group
      `HK26VT477G.app.cadence.desktop` and the Developer ID identity
      (`05-mac-app-store.md`, Section 3.3). Keep Apple's answer in the repository
      docs at activation.
- [ ] **Owner.** Run the upgrade. Keep it away from Mac release windows; forum
      reports describe upload blocks during the change.
- [ ] **Owner.** Turn on auto-renew. Membership is annual; a lapse removes apps
      from sale.
- [ ] **Owner.** As Account Holder, accept new agreements promptly. New versions
      (usually after WWDC) block uploads until accepted. A free app needs no
      paid-apps agreement, tax or banking setup.
- [ ] **Agent.** After the upgrade: run `npm run release:credentials -- status`,
      confirm the Developer ID identity, profile and notarization still pass, and
      record any change in `docs/DESKTOP_RELEASE.md` at activation.

## 2. App Store name, subtitle and trademark

Known collisions (App Store search, October 15, 2026): two "Cadence - Habit
Tracker" apps, "Cadence: AI Habit Coach", "Cadence - Medication Reminders",
"Cadence – GLP-1 Tracker", and the company Cadence Design Systems.

Decided November 25, 2026: scope a distinctive App Store title and subtitle
after trademark clearance. The Home Screen name under the icon stays
**Cadence**.

- [ ] **Owner.** Trademark clearance for the chosen title in the US (the v1.0
      storefront). Counsel's call; not a legal opinion here.
- [ ] **Owner.** Choose the title and subtitle. Candidates:
      "Cadence — Behavioral Remodeling" (matches the D30 positioning,
      `docs/NARRATIVE.md`) or "Cadence: Behavior Tracker". A public claim in the
      subtitle needs a row in `docs/NARRATIVE.md`, "Claims".
- [ ] **Owner.** Reserve the name by creating the App Store record right after
      the organization upgrade and clearance. Creating the record locks the
      bundle identifier choice (`05-mac-app-store.md`, Section 3.3).
- [ ] **Owner.** Decide whether the Mac App Store listing shares the record
      (Universal Purchase) or has its own (`05-mac-app-store.md`, Section 3.3).
- [ ] **Agent.** PLA 3.3.5(C): use one product title everywhere Sign in with
      Apple appears: iPhone, Mac, web and the Apple Services ID display name.
      List every place at activation.
- [ ] **Agent.** Write "Cadence for Apple Watch" for the watch (v1.1).
- [ ] **Agent.** Log the title and subtitle in `docs/MESSAGING_CHANGES.md` for the
      messaging track.

## 3. Age rating and storefronts (v1.0)

### 3.1 18+ rating and age signals

Cadence's Terms require age 18+. App Store Connect requires an override when the
Terms' minimum age is above the computed rating.

- [ ] **Owner.** Answer the age-rating questionnaire (required since January 31,
      2026) and set the **18+ override**. Same for the Mac App Store record.
- [ ] **Agent.** Plan Declared Age Range gating. Use Apple's age signals:
      `isEligibleForAgeFeatures` (iOS 26.2) and `requiredRegulatoryFeatures`
      (iOS 26.4). Block under-18 use.
- [ ] **Agent.** State rules: Apple shares age signals for new Utah accounts
      (May 6, 2026) and Louisiana accounts (July 1, 2026). Texas SB 2420 applies
      since June 4, 2026, under an interim stay. Recheck the stay at activation.
- [ ] **Agent.** Handle `RESCIND_CONSENT` App Store server notifications.
- [ ] **Owner with counsel.** Approve a significant-change policy (which app
      changes trigger renewed parental-consent duties in those states).
- [ ] **Agent.** Rely on Apple's signals; collect no birth date.

### 3.2 US-first launch

Decided November 25, 2026 (owner decision A): v1.0 launches in the United States
only.

- [ ] **Owner.** Set availability to the United States for v1.0.
- [ ] **Owner.** Exclude China mainland in every release. An ICP filing needs a
      Chinese entity.
- [ ] **Deferred to the pre-launch legal and messaging pass:** EU GDPR
      representative and transfer terms (counsel), and the EU DSA trader
      declaration with organization contact details. Both are required before
      any EU storefront opens.
- [ ] **Owner.** Later storefronts follow that pass. Each one rechecks local
      age, privacy and consumer rules.

## 4. AI consent and health-adjacent categories

Decided November 25, 2026. This replaces B 14, item 11 (whether to exclude
Medical and Measurements Behaviors from model input).

- [ ] **Agent.** Follow web's unified AI approval (`Settings → AI features`;
      `components/onboarding/AiFeaturesApproval.tsx`). One approval covers every
      Behavior, including **Medical** and **Measurements**. No category is
      excluded.
- [ ] **Agent.** Show a native consent sheet before the first transmission to
      the model (guideline 5.1.2(i)). It names OpenAI, lists the data sent
      (Behavior names, schedules, history; Calendar and Notes only when enabled;
      Chat messages), states retention, says how to revoke, labels output as
      AI-generated, and says "not medical advice".
- [ ] **Agent.** Ask again when the data sources expand. Revocation stops all
      AI features until approved again.
- [ ] **Owner.** Primary category **Productivity**. No Health & Fitness secondary
      category. This avoids guideline 1.4.1 medical scrutiny. Make no medical
      claims in metadata.
- [ ] **Agent.** Confirm the Privacy and Terms pages and the processor table
      name OpenAI (October blocker, B 7.1; marketing copy names OpenAI since
      then). Full text belongs to the messaging pass (Ticket 246).

## 5. Privacy label, privacy manifests and logging

### 5.1 App Privacy label (v1.0)

v1.0 has accounts, so the label is not empty. All data is linked to the person.
None is used for tracking.

| Data type | Why |
|---|---|
| Email Address | Account |
| Name | Apple returns it on first authorization; Google profile |
| User ID | Account |
| Other User Content | Behaviors, Notes, statuses, timing, Daily Brief and Chat payloads |
| Health & Fitness | Declare while the default Medical, Measurements and Fitness categories remain; they invite health data |
| Precise Location | While Using the App: Travel and completion place labels |
| IP address (in server logs) | Declare per Apple's guidance |

- [ ] **Agent.** Draft the label from the table; check it against the hosted
      processors in the Privacy page.
- [ ] **Owner.** Enter it in App Store Connect for each record.

### 5.2 Privacy manifests

- [ ] **Agent.** One `PrivacyInfo.xcprivacy` per bundle: iPhone app, widget
      extension, watch app and watch widgets (v1.1), and the Mac App Store build.
- [ ] **Agent.** Expected required-reason codes (from the October compliance
      review): `CA92.1` (user defaults), `1C8F.1` (user defaults in an App
      Group), `C617.1` (SQLite `stat`/`fstat`), `3B52.1` (user-picked import
      files), `35F9.1` if uptime APIs appear.
- [ ] **Agent.** Build SQLite with `SQLITE_ENABLE_LOCKING_STYLE=0`, or declare a
      reason for `statfs`.
- [ ] **Agent.** Verify with a symbol scan of every binary, including the Rust
      library, and Xcode's privacy report.

### 5.3 Other submission settings

- [ ] **Agent.** `ITSAppUsesNonExemptEncryption = NO` (standard encryption only).
- [ ] **Agent.** Test on a NAT64 network. App Review uses IPv6.
- [ ] **Agent.** Test iPad compatibility mode. Review runs iPhone apps on iPad.
      Anchor share-sheet popovers.
- [ ] **Owner.** Accessibility Nutrition Labels are voluntary now; Apple says
      they become required, with no date. Declare only features where every
      common task works, with evidence.
- [ ] **Agent.** `os.Logger`: dynamic values stay private by default; mark only
      codes and IDs public. Sysdiagnose collects logs.
- [ ] **Agent.** Background modes only for intended use (2.5.4): `fetch` and
      whatever Live Activity push delivery needs (`02-iphone-native.md`).
- [ ] **Agent.** No downloaded code (2.5.2): the engine bundle ships in the
      binary.
- [ ] **Agent.** Push is never required to use the app (4.5.4); notification
      text carries no sensitive data when previews are hidden.

## 6. Assets, audio, reviewer access and repository hygiene

### 6.1 Audio provenance

- [ ] **Owner.** `public/sounds/completion-chime.mp3` is byte-identical to an
      untracked file named like a text-to-audio prompt. Record the generator,
      plan tier, output license and inputs, or replace it with cleared audio.
- [ ] **Owner.** Delete the two untracked files in `public/sounds/` in the
      owner's checkout. They are YouTube rips of Xbox achievement sounds.
- [ ] **Agent.** iOS completion sound: ambient audio session, respects the
      silent switch, paired haptics, cleared audio only.

### 6.2 Repository hygiene

- [ ] **Owner.** Move the two untracked files in `apps/desktop/signing/`
      (a Developer ID profile and certificate) out of the repository.
- [ ] **Agent.** Add to `.gitignore`: `xcuserdata/`, `DerivedData/`,
      `*.xcarchive`, `*.p8`, `*.p12`, `*.mobileprovision`, `*.provisionprofile`,
      `Local.xcconfig`. Add a secret scan.
- [ ] **Agent.** Open source: contributors build with their own team through a
      gitignored `Local.xcconfig`. Team IDs are public; keys, certificates and
      profiles are not.

### 6.3 Notices

- [ ] **Agent.** Acknowledgements screen: IBM Plex (OFL-1.1), ICU crates
      (Unicode-3.0), MIT, Apache and ISC packages.

### 6.4 App Review access (required at the first submission)

v1.0 requires sign-in, so App Review needs a way in (guidelines 2.1(a) and
2.3.1(a)).

- [ ] **Owner.** Create a demo account for App Review, or document that
      reviewers sign in with Apple. A reviewer who signs in with Apple sees an
      empty account.
- [ ] **Agent.** Review notes: sign-in steps, how to add sample data (or a
      pre-filled demo account), and where each feature lives.
- [ ] **Agent.** Screen recordings for system surfaces: Live Activities
      (timer and upcoming Behavior), Widgets, Controls, Siri and Shortcuts.
- [ ] **Agent.** State Calendar status. Google verification is incomplete, and
      Calendar requires the sign-in Google account (`same_account_required`).
      Either Calendar passes its identity and verification gates before
      submission, or the notes say it is unavailable to reviewers.
- [ ] **Agent.** Describe every extension in the listing.

### 6.5 Test hardware

- [ ] **Owner.** iPhone SE (2nd gen) or iPhone 11 on iOS 27: the low-end budget
      floor (`07-build-phases.md`, M1).
- [ ] **Owner.** A current Dynamic Island iPhone with the Action button.
- [ ] **Owner.** For v1.1: an Apple Watch Series 9 or later, and a Series 6–8
      watch on watchOS 26. watchOS 27 drops Series 6–8, SE 2 and the original
      Ultra. Pairing a watchOS 26 watch with an iOS 27 iPhone is reported on
      forums, not documented by Apple (`IOS-201a`).
- [ ] **Owner.** Developer Mode on each device.
- [ ] **Owner.** A test Apple Account for sign-in and TestFlight.

### 6.6 Listing assets and URLs

- [ ] **Owner.** Icon Composer: Default, Dark and Mono variants, checked at
      small sizes.
- [ ] **Owner.** Support URL with contact details.
- [ ] **Agent.** Privacy Policy URL, in App Store Connect and in the app
      (5.1.1(i)), with an iOS section. Text belongs to the messaging track.
- [ ] **Agent.** Screenshots with fictional data. Watch screenshots when the
      watch app ships.

## 7. Store operations to know before the first submission

From B 17.2.

- TestFlight: internal testers need no review. External testers need Beta App
  Review for a version's first build. Builds expire after 90 days. Use external
  TestFlight early; Beta App Review is a cheap guideline check.
- Review results arrive in App Store Connect. You can reply, resubmit, appeal or
  request expedited review.
- Phased release applies to updates, not the first version. Use manual release
  for v1.0.
- Promotional text changes without review. Other metadata needs a submission.
- `requestReview` shows at most three times a year and does nothing in
  TestFlight. Prefer a Settings link to write a review.
- Apple raises the minimum SDK each spring (Xcode 26 and the iOS 26 SDK since
  April 28, 2026) and ships betas each June. Budget an annual SDK and OS
  adoption step.

## 8. Owner portal steps at activation

From B 13. These follow the organization upgrade.

- [ ] Developer portal: App IDs, App Group, capabilities (Sign in with Apple,
      App Groups, Push for Live Activities), devices. Proposed identifiers:
      `app.cadence.ios`, `.widgets`, `.watchkitapp`, `.watchkitapp.widgets`,
      App Group `group.app.cadence.ios`. They lock at the first upload; settle
      the Universal Purchase question first (item 2).
- [ ] App Store Connect: create the app record, internal tester group,
      export-compliance answer.
- [ ] App Store Connect API key with the Developer role, stored outside git.
      D29.4 created one for notarization; decide reuse or a second key.
- [ ] Sign in with Apple for iOS: Supabase redirect URLs and Apple client IDs;
      Services ID and Sign in with Apple key (6-month client secret rotation);
      Private Email Relay sender registration with SPF and DKIM aligned
      (L-024).
- [ ] Associated domains and `apple-app-site-association` for Universal Links
      and the Google callback. Apple's CDN can take up to 24 hours to fetch
      changes. Smart App Banner on web after release.
- [ ] iOS Calendar callback under the Google project that Ticket 187 uses.

## 9. Mapping to steps

| Checklist item | Step in `07-build-phases.md` |
|---|---|
| 1, 6.2, 6.5, 8 | `IOS-188a` |
| 2, 3, 4, 5, 6.1, 6.3, 6.4, 6.6 | `IOS-209` |
| 7 | `IOS-211` |
| Mac App Store record, rating and label | `IOS-MAS-2` |
