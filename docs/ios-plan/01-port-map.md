# 01 · Web-to-iPhone Port Map and Standing Rules

> **Status:** Part of the running iOS blueprint (`docs/IOS_PLAN.md`). Not authorized for
> implementation. No iOS code, real ticket or ticket number exists. Mobile work stays out
> of scope in `AGENTS.md` until the owner activates the track.
>
> **Synced through:** `64b78b80` (`origin/main`, November 25, 2026).
>
> **Not a source of truth.** Product behavior is owned by `docs/UI_SPEC.md`,
> `docs/USER_FLOWS.md`, `docs/ROUTE_MAP.md`, `interaction-registry.json` and
> `docs/DECISIONS.md`. This file says how each shipped web behavior lands on iPhone. When
> the two disagree, the web docs win and the next `ios-plan-sync` run fixes this file.
> `IOS-` IDs are plan-local step labels, not ticket numbers.

---

## 1. Owner decisions this file implements (2026-11-25)

1. **Mirror mobile web 1:1.** Every screen, navigation path and flow on mobile web
   (390 px) reaches iPhone with the same order, words and outcomes. Nothing is invented
   from scratch. Only the controls change: each web pattern maps to its native SwiftUI
   equivalent (Section 3).
2. **Five primary screens**, matching `docs/ROUTE_MAP.md` and `docs/UI_SPEC.md`, "Primary
   navigation": Timeline (default), Chat, Behaviors, Export & Import, Settings. Login and
   Onboarding sit in front of them.
3. **Explicit sizing** across three iPhone width tiers and Dynamic Type through AX5
   (Section 4).
4. **Every web feature shipped or decided through `64b78b80`** is mapped (Sections 5–10).
   Features behind a production-off flag on web (for example `CADENCE_ALONGSIDE`) port
   behind the same server flag; iPhone never turns on a feature that web has off.
5. **Standing port rules** let the every-other-day refresh fold routine web changes in
   without asking (Section 12). **Co-development** replaces the refresh once iOS
   activates (Section 13).

Impact summary: web, desktop and marketing are not changed by this file. Future mobile is
this file. Messaging impact: none.

---

## 2. Shared foundations the port relies on

| Concern | iPhone approach | Web or Mac reference |
|---|---|---|
| Domain rules | Same `@cadence/core` resolvers, run in the app's embedded JS runtime (engine choice in `04-accounts-sync-offline.md`). No Swift re-implementation of recurrence, status, timeline grouping, reminders, analytics, export, free-slot, effective-Where or alongside rules. | `packages/core/src/resolvers` |
| Writes | Same operation set the Mac uses through `apps/desktop/src/local-actions.ts`: local SQLite write plus outbox, then sync. Status writes carry `expectedStatus` and a `commandId`. | `lib/services/occurrence.service.ts`; `04-accounts-sync-offline.md` |
| Notices | Every notice's words come from `packages/core/src/notices/catalog/*.json` through `noticeText(id)`. Swift never hard-codes notice text. | `components/feedback/Notice.tsx` |
| Avatar | States and gestures come from `packages/core/src/advisor-avatar/catalog.json`; one resolver picks the state. Assets are generated from `assets/advisor-avatar/master.svg`. | `components/advisor/AdvisorAvatar.tsx` |
| Hosted features | AI (Daily Brief, Coach, Chat, AI Notes), connectors, travel routing and place search call the same hosted routes as the Mac, with a Bearer session. | `docs/ROUTE_MAP.md` |
| Interaction inventory | Each `interaction-registry.json` intent with mobile status `deferred` becomes `implemented` with an iOS reference at build time. `not_applicable` intents stay so. | `docs/INTERACTION_REGISTRY.md` |

### 2.1 Design tokens

- `CadenceTokens.swift` is **generated** from `packages/ui/tokens.css` by a script added at
  activation. It is never hand-edited. The generator keeps the surface scoping in
  `tokens.css` (theme surface, ink, Ash Line, Rust Signal danger, brand blue, the Poline
  magenta `#DA3278` and the status fills) and emits one `Color` per token, with light and
  dark values from the theme variables.
- Every `font-weight-*` token is 400 in `tokens.css`. The generator keeps that: Cadence
  uses IBM Plex Sans Regular throughout, and emphasis comes from size and position.
- Typography: IBM Plex Sans ships in the app bundle (licence in
  `packages/ui/LICENSE.fonts.txt`) and is applied with
  `Font.custom("IBMPlexSans-Regular", size:relativeTo:)`, so every style scales with
  Dynamic Type. Tabular figures (timer, counts) use `.monospacedDigit()`.
- Square corners on Cadence content stay square. System chrome (tab bar, navigation bar,
  sheets, menus) keeps the system's Liquid Glass shapes; Cadence does not restyle it.
- A token added to `tokens.css` reaches iPhone on the next generator run. The sync rule in
  Section 12 treats it as routine.

### 2.2 Completion chime

- One successful user-initiated change into Completed plays the completion chime once,
  with a light success haptic (`.sensoryFeedback(.success, trigger:)`). Not Completed,
  note saves, refreshes and re-saving an already Completed Occurrence play nothing, as on
  web (`docs/UI_SPEC.md`, "Occurrence card").
- Audio uses an `AVAudioSession` category of `.ambient`, so it mixes with other audio
  and respects the Ring/Silent switch. The haptic still fires when silent.
- **Gate:** the chime file needs a provenance record before it ships. The two untracked
  sound files in the owner's checkout do not qualify (`docs/IOS_PLAN.md`, "Prerequisite
  tracker"; `06-app-store-readiness.md`).

---

## 3. Web pattern to SwiftUI idiom

| Web pattern | iPhone idiom | Notes |
|---|---|---|
| Mobile sticky header + left drawer with five links | Native `TabView` with five tabs (Timeline, Chat, Behaviors, Export & Import, Settings), Liquid Glass tab bar | Tab order matches the drawer order. The tab bar minimizes on scroll (`.tabBarMinimizeBehavior(.onScrollDown)`). The drawer's Sign out moves to Settings → Account and data. |
| Unboxed list rows with native `details` disclosure | `List` with `.listStyle(.plain)`, rows that expand inline (`DisclosureGroup`-style custom row) | No row borders; one quiet divider between rows, as on web. |
| Underlined text actions (Completed, Not Completed, Note) | Same visible underlined text buttons in the row, 44 pt targets; also **swipe actions** (leading: Completed, trailing: Not Completed) and a **context menu** (Completed, Not Completed, Note, Track Time) | Swipe and menu add speed; they never replace the visible actions. |
| Full-page Behavior form | Editor in a **sheet** (`.sheet` with `.presentationDetents([.large])`), Save and Cancel in the toolbar | An unsaved draft asks before dismissal (`.interactiveDismissDisabled` while dirty, with a confirmation). |
| Non-modal bottom preview and centered details dialog (Calendar, travel) | Bottom sheet with `.presentationDetents([.height(…), .medium])` and `.presentationBackgroundInteraction(.enabled)` for the preview; a `.large` sheet for View details | Preview stays non-modal: the Timeline stays scrollable behind it. |
| Needs decision modal | Full-height sheet | Feed-led, close button top right, no global title, as on web. |
| Pull to refresh at the top of Timeline | `.refreshable` | One pull, one refresh; Cadence and Calendar data reload. |
| Search fields (Calendar list, place search, Behaviors filters) | `.searchable` where a list is filtered; `TextField` with suggestions for place search | |
| `<input type="date">`, `<input type="time">`, presets | `DatePicker` (`.compact` in rows, `.graphical` in date review), time presets as a `Picker` | Time ranges keep the preset labels (Morning, Afternoon, Evening, Night). |
| `<select>` | `Picker` with `.menu` style | Default option keeps "(default)" in its label. |
| Checkbox / toggle that auto-saves | `Toggle` that writes on change | No Save buttons where web has none (Ticket 303). |
| Drag-to-reorder Categories | `List` with `.onMove` and an always-visible drag handle; **Move up / Move down** as VoiceOver custom actions | Announces "Fitness moved to position 2 of 8." through `AccessibilityNotification.Announcement`. |
| Inline confirm line (danger + Cancel) | Same inline line; destructive deletes use `.confirmationDialog` only where web uses a typed confirmation | No new modals. |
| Toasts / status lines | Inline status lines from the notices catalog; polite announcements via `AccessibilityNotification.Announcement` | |
| Share / download links | `ShareLink` and `.fileExporter`; `.fileImporter` for import | iPad compatibility: share popovers anchor to their button. |

---

## 4. Sizing and layout

### 4.1 Width tiers

| Tier | Devices (portrait points) | Layout rule |
|---|---|---|
| **Compact** | iPhone SE (2nd/3rd gen) and mini, ~375 pt | Mobile web at 375 px is the reference. Row: time, title and both status actions on one line; the title truncates before targets shrink. Routine bulk marks move to a second line, right-aligned (web below 576 px). Travel label stacks on two lines. Opportunity sheet uses `.medium` detent. Horse 60 pt; speech pill stacked below with a top tail. |
| **Standard** | iPhone 16/17 and Pro, ~390–402 pt | Mobile web at 390 px is the acceptance width (`docs/UI_SPEC.md` names 390 px). Same structure as Compact with less truncation. |
| **Pro Max / Plus** | ~430–440 pt | Same single-column structure. Extra width goes to title length and to keeping row details on one line; no second column, no side panel. Calendar context keeps its left rail. |

Rules for every tier:

- Respect safe areas; the Needs decision bottom action spans the safe-area width above the
  tab bar.
- Landscape keeps the single column at readable width (`.containerRelativeFrame` capped
  near 600 pt). iPad runs the iPhone layout in v1.0.
- Every interactive target is at least 44 × 44 pt, matching web's 44 px rule.
- No horizontal scroll at any tier, matching web's "no horizontal scroll at 390 px".

### 4.2 Dynamic Type through AX5

- All text uses `relativeTo:` styles; nothing is fixed-size except the decorative horse
  and the day-progress axis.
- Rows that hold several elements on one line wrap them in `ViewThatFits`: first the
  one-line layout, then a stacked layout (title on top, status actions below). At
  accessibility sizes the stacked layout is always used.
- The day-progress axis narrows and drops clock labels into the row at accessibility
  sizes; the current-time dot stays.
- Timer digits, counts and progress ("2/3") use `.monospacedDigit()` so they do not
  reflow each second.
- Test at Default, XL, AX3 and AX5 on Compact and Pro Max in Xcode Previews and snapshot
  tests (`07-build-phases.md`).

### 4.3 VoiceOver and Voice Control

- Each Occurrence row is **one VoiceOver element** (`.accessibilityElement(children:
  .combine)`) that reads time, title and state ("9:00 AM, Take medication, Unresolved").
  Its **custom actions** are Completed, Not Completed, Note, Track Time and, when
  present, Remove and Expand.
- A routine row reads "Morning routine, 9:00 AM, 2 of 3 done" with custom actions
  Completed (all steps), Not Completed (all steps) and Show steps.
- Voice Control names match visible labels exactly ("Tap Completed"). Icon-only controls
  carry `.accessibilityInputLabels` that match their accessible name.
- The timer counter never announces each second. Start, Stop, Reset and errors announce
  once, as on web.
- Reduced Motion: the horse shows its still drawing; Semantic Zoom reveal and banner
  animations turn off.
- Decorative images (wave banner, horse-line image) are hidden from accessibility; the
  speech pill and its dismiss control are semantic.

---

## 5. Login and Onboarding

| Web behavior | iPhone port |
|---|---|
| Google sign-in (Supabase Auth) | `ASWebAuthenticationSession` OAuth flow against Supabase, PKCE, session tokens in Keychain. |
| Apple sign-in (D31, web OAuth) | **Native Sign in with Apple** (`SignInWithAppleButton`) exchanging the identity token with Supabase. Hide My Email relay addresses follow the D31 rules. |
| Email: a link or a 6-digit code, no password | 6-digit code is the primary iPhone path (`.textContentType(.oneTimeCode)` for autofill). A magic link opens the app through a Universal Link when tapped on the phone. |
| Sign-in required before use | Same: no anonymous mode. After first sign-in, tracking works offline (`04-accounts-sync-offline.md`). |
| A sign-in never reaches an account through an unconfirmed email | Same server rule; no client change. |
| Onboarding: AI features approval (Notes and advisor), timezone, first Behavior, optional first-run setup pop-up | Same steps as a paged flow in a sheet. The dismissible first-run setup pop-up becomes a dismissible card above the Timeline feed that does not push the feed down. Notification permission is **not** asked during onboarding; it is asked once in context after the first Behavior exists (`02-iphone-native.md`). |
| Timezone default America/New_York | Default to the device's `TimeZone.current` suggestion, with America/New_York as the fallback the docs name; the person confirms. |

---

## 6. Timeline (tab 1, default)

### 6.1 Layout and day structure

- **Day-progress layout** (Tickets 133–136): one vertical axis left of the ledger,
  item-only clock labels, one brand-blue current-time dot updated once per visible minute
  and paused when the app is inactive. Calendar context stays left of the axis, the
  ledger stays right. No visible page title; the decorative horse-line image and wave
  banner sit above the feed.
- **Current day first**, then the next 7 days, then **Show more days** that preserves
  scroll position (`ScrollViewReader` anchored to the first newly shown day).
- Same-Behavior multi-time days group as a stack; each time is its own row; no partial
  progress fill or "1 of 2" label.
- Empty day: "No behaviors on this day".
- **Pull to refresh** with `.refreshable`; success feedback only after successful reads;
  partial failure is reported and data kept.

### 6.2 Occurrence rows and statuses

- Collapsed row: scheduled time (or preset label such as Morning), title, and either the
  Completed / Not Completed actions (Unresolved) or the status label (Completed in full
  blue, Not Completed in the red accent). Never "missed" or failure language.
- Expanded row (tap outside the actions): description, category, schedule, Track Time,
  Note, change-status option. The open row holds the hover-blue background. No
  confirmation before a status change.
- **Needs decision:** a fixed bottom action spanning the safe-area width, showing the
  count of prior unresolved Occurrences in the reserved fixed-action treatment. It opens
  a full-height sheet grouped by local day ("2 left to decide" / "None left to decide").
  Rows resolved today stay in their original day group until local midnight, derived from
  `status_marked_at`.

### 6.3 Notes

- **Collapsed one-line closure** (2026-11-25): "Add note" or "Note" + one-line preview;
  "Add day note" or "Day note" + preview under each day's date.
- Opening shows the shared editor with no duplicate label. **Auto-save** after ~750 ms of
  no typing, immediately on a shortcut chip tap, and on focus loss without collapsing.
  **Done** (toolbar button above the keyboard, plus Return-with-modifier on hardware
  keyboards) flushes and collapses with a quiet "Saved" that fades after ~2.5 s, leaving
  the parent row open.
- A conflict (`expected_note` compare-and-set) or error keeps the draft and offers **Try
  again**.
- **Note shortcut chips** inline above the field: accepted and proposed shortcuts ranked
  by frequency and recency, at most 5, each with an inline × dismiss. Deterministic
  matching uses full history with a floor of 2 distinct Occurrences or day notes. AI
  pattern chips appear only when Settings → AI features → Notes is on. No shortcut
  management screen in Settings or Behavior settings.

### 6.4 Time tracking and durations

- **Track Time** in expanded rows for today's Occurrences and visible Needs decision
  rows: idle → running (static "Track time" label, `HH:MM:SS` counter via
  `Text(timerInterval:)`, **Stop**, **Reset tracked time**) → stopped total with **Track
  Time** and **Reset tracked time**. Reset has no confirmation.
- **Completed auto-stops a running timer** (Ticket 351), including routine bulk marks and
  marks from Siri, widgets, notifications and Live Activities. Not Completed and
  Unresolved leave it running. Stopping a timer never changes status.
- Starting a timer also starts the **Active Timer Live Activity** (`02-iphone-native.md`).
- **Inline duration controls and estimates:** the Behavior's default length, measured
  estimates and model estimates ("estimate" label) show as on web; possible-overlap cues
  stay separate from running timers and from status.

### 6.5 Places and travel

- **Completion place labels** (Ticket 216): silent labels on completion, Where
  suggestions with Review Where / Dismiss, marker prompt with I'm here / Not now, all from
  the same resolvers. Device position is read only while the app is in use.
- **Learned travel habits** (Ticket 217): get-ready and arrive-early sentences with inline
  `Picker`s; "Travel by" per trip; the once-a-day "Your leave time for {title} was:" Too
  early / About right / Too late / Not now question.
- **Travel advisory** (Tickets 263–285): the next-departure line at the top of the
  Timeline with its **Refresh travel** action; one magenta span from leave time to arrival
  and one leader with its label ("Leave 9:35", two stacked lines on phones; "Home {time}"
  for the return); "Leave now", "May arrive late", "Arrive about", "Home about", "Head
  home now" states; place-step sentences whose first words act ("Add a place for
  Dentist"); "Turn on Travel estimates in Settings…" with Not now; tomorrow's first trip
  once today has none; per-trip **Change for this trip** and remembered places. Only the
  next trip gets the span without inspection. The leader and label are decorative and not
  accessibility elements; the line is the accessible text, announced only on the changes
  web announces.
- **Calendar context** (Google, Outlook, iCloud; read-only): markers with stems, all-day
  "All day: {title} +N more" with Restore, bottom preview with View details, magenta
  hover span becomes a **tap** span on iPhone. Directions open **Apple Maps**
  (`MKMapItem.openMaps` or `maps://`), as web does on Apple devices.

### 6.6 Connector completion (D28)

- A Completed row written from Hevy shows its connector label ("Completed from Hevy" in
  catalog words) and can be changed like any status; after a manual change nothing from
  the connector completes that Occurrence again.
- No "Recorded activity · Hevy" header or empty state above the Timeline (2026-11-24).
  Manual workout counting on rows stays.

### 6.7 Routines and Semantic Zoom (Ticket 349)

- A routine slot is one parent row: disclosure, title, slot time, derived state ("2/3",
  or Completed / Not Completed fill) and bulk **Completed** / **Not Completed** on today
  and Needs decision; none on future days. On Compact and Standard widths the bulk marks
  sit on a second, right-aligned line.
- Opening lists steps as normal Occurrence rows with their own actions, notes, timers and
  connector labels.
- **Semantic Zoom:** layer 1 **Routines**, layer 2 **All steps**. A segmented
  **Routines / All steps** control above the first day appears only when a routine is
  visible. A **pinch** (`MagnifyGesture`) past a threshold switches once per gesture;
  scrolling never switches. Opening one routine overrides the layer until the layer
  changes. Reduced Motion turns off the reveal. The control is the accessible path; pinch
  is never the only way.

### 6.8 Opportunity Basket

- "Opportunity (n)" text action under today's date opens a bottom sheet (Compact:
  `.medium`; others: fitted height up to ~55 % of the screen), non-modal.
- Each item: title, "{length} min · {Where}", "On today" when present; **Add to today**
  (Exact time default at the suggested time, or Time window: Morning / Afternoon /
  Evening / Night / Custom From–To; Add posts once) and **Done now** (adds at the current
  minute and marks Completed; each tap is a new client id).
- Added rows show "Added", "Added from Daily Brief", "Added in Chat" or "Added by a
  connected app", and a clean added row offers **Remove**.

### 6.9 Alongside Behaviors (D33, behind `CADENCE_ALONGSIDE`)

- An alongside item keeps its row and shows a small "alongside" label; a guessed value is
  labelled as a guess.
- Allowed same-place overlaps show no conflict cue; disallowed overlaps (travel, another
  place) cue as any other.
- After a row is marked Completed and the answer is missing and the guess is yes, the row
  may ask "Can this be done alongside other things?" in the "Done at · Just now · Other
  time" pattern. One answer anywhere closes the question everywhere.
- Pairing moves ("Do Red light helmet during Reading at 8:00 PM") arrive as ordinary
  Daily Brief or Chat moves.

### 6.10 Advisor banner and panel

- **Horse avatar at 60 pt** on the wave banner (out of the navigation bar), animated from
  the catalog's states and gestures; Reduced Motion shows the still drawing. Assets:
  `advisor-60-{1,2,3}x` from the master.
- **Speech pill** stacked directly below the horse with a top tail when something is
  waiting and the panel is closed, showing the `advisorBubbleTeaser` text; otherwise a
  quiet "Advisor" label. The banner scrolls with the page. No `AdvisorDayLine`.
- Tapping the horse or pill opens the **Advisor panel** as a sheet (`.medium` and
  `.large` detents):
  - **Daily Brief:** lines with **Yes · No · Other time**, **Accept all**, **Already did
    it**, **Undo**. Re-check runs on every open (`/api/advisor/brief/recheck`); a taken
    slot arrives re-planned with its reason. Refusals name the cause. **Don't suggest
    moving this** after No or Undo on four different days. Moves change today only.
  - **Coach:** daily tips, past tips drilldown, and schedule proposals ("Try for two
    weeks") that the person confirms.
- The banner never blocks tracking or steals focus.

---

## 7. Chat (tab 2)

- Mirrors `/chat`: one streamed reply per question from `/api/advisor/chat` (NDJSON
  `ChatEvent`s), the same operations MCP clients run (`executeMcpOperation`), writes with
  **Undo** or one Yes/No confirm, **Stop**.
- **Thinking horse animation** at 48 pt beside the reply while it streams; the **action
  summary** shows as one line and opens a box that lists every action (PR #397).
- **Starter prompts** (up to three, `/api/advisor/chat/starters`) on an empty
  conversation; conversation list and view.
- Bounded **past calendar drill-down** (≤31 days per call) and workout reads come from
  hosted rollups, as on web.
- Follows **Settings → AI features**: when chat is off the server returns `chat_off` and
  the tab shows the catalog notice with a link to Settings.
- **Requires network.** Offline, the composer is disabled with one notice line; past
  conversations already loaded stay readable.
- Composer: multi-line `TextField(axis: .vertical)`, Send in the keyboard toolbar, iOS
  dictation allowed (system keyboard). No speech features of Cadence's own.

---

## 8. Behaviors (tab 3)

- **Analytics at the top:** overall adherence with 7 / 30 / 90 day controls (segmented
  `Picker`), passive overall heatmap; "+N opportunity Completed" when relevant.
- **Rows:** title, range adherence with Completed / Not Completed counts, per-Behavior
  heatmap sized to the row. A non-empty heatmap cell opens **Behavior date review**
  (display-only date and time, status and note behind a per-Occurrence Review
  disclosure).
- **Details and Settings** disclosure reveals configuration, then **Edit** opens the
  Behavior editor sheet; **Archive behavior** at the end in Rust Signal; **Restore** on
  archived records in an Archived behaviors disclosure at the bottom.
- **Filters:** Category (All, No category, each category) and Sort (Scheduled time, Name
  A–Z, Category) as menu pickers, matching/total counts, **Clear filters**.
- **Not running** group for **Ended and Paused Behaviors** (Ticket 342 on Mac; web
  first): End now, Pause, and the back-on day rule as on web.
- **Opportunity group** below the running list: "Done N times", heatmap, average tracked
  time, never an adherence percentage; a scheduled Behavior that is also an opportunity
  shows a muted "Opportunity" word.
- **Routines:** "Sub-behaviors (n)" nested under the parent with rolled-up Adherence,
  Completed, Not Completed and "Full routines x of y".

### 8.1 Behavior editor (sheet)

Field order follows `components/behaviors/BehaviorForm.tsx`:

- Title, Description, **Where** (Not set, Anywhere, Home, A place + Place text) with its
  hint, Category, schedule (Daily, Every N days, Weekly on weekdays, Every N weeks on
  weekdays, Monthly on day N with last-day fallback; times or preset ranges; no raw cron,
  no natural language), Default duration, Ends after, reminders (browser reminders on by
  default become **device reminders**; email reminders off by default with offsets).
- **Part of** and **Follow parent schedule**; **Add sub-behavior** drafts with Up, Down,
  Remove; a saved routine's manager with Up / Down, Detach, New sub-behavior, Add an
  existing behavior.
- **Available as an opportunity** and **No fixed schedule**.
- **Alongside** setting ("Can this be done alongside other things?"), showing the guess
  and its source; guessed Where shown as a guess (behind `CADENCE_ALONGSIDE`).
- **Place autocomplete:** instant local saved-place matches first, then Geoapify results
  through the hosted route (never a direct provider call from the app); the safe
  auto-marker with **Undo**.
- **Hevy source link** for connector completion (D28) when Hevy is connected.
- iPhone-only per-Behavior toggle: **Show Live Activity before it starts** (default on;
  `02-iphone-native.md`).
- Every server validation key has a visible error next to its field.

---

## 9. Export & Import (tab 4)

- Options first: Last 7 / 30 / 90 days, All time, Include archived, Include occurrence
  notes (off), Include time tracking (off, with the factual pattern-exposure copy), and
  the selected-range scope counts.
- Outputs: **JSONL**, **CSV**, **full JSON snapshot**, **BehaviorLog bundle**, **Copy AI
  summary**. Files are built locally from SQLite with the shared export resolver and
  offered through `ShareLink` / `.fileExporter`. Share popovers anchor to their button
  for iPad compatibility.
- **Import / restore:** `.fileImporter` for supported files, then the same restore
  **preview** web shows before anything is written.
- Long exports and imports show progress with **Cancel**, and run under
  `BGContinuedProcessingTask` so they continue with system progress UI when the person
  leaves the app.
- Works offline for local data; the AI summary copy follows web's rules.

---

## 10. Settings (tab 5)

Same four groups, order and state rows as web (Ticket 301), auto-save everywhere
(Ticket 303). A section index becomes a jump menu in the navigation bar.

| Group | Contents on iPhone |
|---|---|
| **General** | Profile, Timezone, Notifications (device permission state, **Reminders on this device**, **Lock Screen privacy**, **Reminders scheduled through {date}**), Categories drawer ("Edit N categories", drag to reorder, edit/delete with affected count). |
| **Connections** | Connected sources rows (Google Calendar, Outlook, iCloud, Hevy) with icon, kind and state; opening shows the source panel. **Connected apps** (MCP grants): view and revoke only. OAuth **consent** screens stay web-only (`not_applicable`). |
| **Planning** | **Travel** (usual travel, Travel estimates toggle with Google Maps disclosure, Home with Geoapify autocomplete and **Use my current location**, remembered places, How you travel, Completion places, **leave reminders** opt-in), **Daily Brief** (one choice for every connected source, per-source exclusions under Advanced). |
| **Account and data** | **Sign-in methods** (list, add Google / Apple, change email, remove while another way in remains, 15-minute recent sign-in rule), **AI features** (one approval covering Notes, Daily Brief, Coach and Chat, with the "not medical advice" line), Open Export, Privacy / Terms / Trust links, Sign out, **Delete account** (typed address or `DELETE`; in-app deletion required by App Store rules; Apple token revocation). |
| **This iPhone** (new, like Mac's "This Mac") | **Live Activities** (global switch, default on; timer Live Activity on/off), **Spotlight** (index Behaviors; off clears the index at once), **Siri & Shortcuts** link to system settings, storage and sync status. |

Not on iPhone: the Mac-only Daily Brief on the person's ChatGPT plan (D27) stays outside
iPhone parity; desktop storage and updater controls; the Mac's local-mode controls.

---

## 11. Not applicable on iPhone

| Web or Mac feature | Reason |
|---|---|
| OAuth consent pages (`/oauth/*`) | A browser flow for third-party clients; the phone opens it in Safari if a client sends the person there. |
| Marketing site, public legal pages | Linked out to Safari. |
| Dockable sidebar, hover previews | Replaced by the tab bar and tap previews. |
| Daily Brief on ChatGPT plan (D27) | Mac-only by decision. |
| `/design-system` bench, development login | Not shipped. |
| Desktop updater, local-only mode | App Store updates; sign-in required. |

---

## 12. Standing Web-to-iPhone Port Rules

The `ios-plan-sync` skill runs every other day. It reads web work merged since the cursor
in `docs/IOS_PLAN.md` and applies these rules without asking the owner.

### 12.1 Auto-port (no question)

Fold the change into the matching module, using mobile web at 390 px as the reference,
when it is any of:

- A new or changed Behavior field, form section, validation rule or Behaviors list
  detail.
- A new or changed Timeline row detail, action, grouping, label or status line.
- A new Settings option or row inside the existing four groups.
- A new or changed shared resolver, notice, avatar catalog state or design token.
- A new Advisor, Daily Brief, Coach or Chat capability served by hosted routes.
- A new hosted connector read, or a connector state shown in Settings.
- A Mac sync contract or SQLite schema bump (recorded in `04-accounts-sync-offline.md`).
- A new export field or format variant.
- A web flag (on or off in production): port behind the same server flag.
- A removal on web: remove the same thing from this file.

Each auto-port records one Sync Log line in `docs/IOS_PLAN.md` and updates the parity
snapshot from `interaction-registry.json`.

### 12.2 Log an Open Question in `docs/IOS_PLAN.md` instead

Only when a merged web change does one of these:

1. Creates a product choice on an **iOS-only surface**: Live Activities, Widgets,
   Controls, Siri / Shortcuts / Spotlight, Apple Watch, notifications (actions,
   permission timing, Lock Screen content), or location permission level.
2. Has no clean mobile-web reference (a desktop-only interaction with no 390 px layout).
3. Affects **App Store or Mac App Store compliance**: privacy label or manifest, data
   collection, age rating, AI consent, sign-in methods, account deletion, payments,
   sandbox.
4. Conflicts with a locked owner decision in `docs/IOS_PLAN.md`, Section 2.

The question names the web change, the iOS surface and two or three options with a
recommendation. The refresh still ports every other part of the change.

### 12.3 Never

- Never edit files outside `docs/IOS_PLAN.md` and `docs/ios-plan/`.
- Never block, delay or comment on a web ticket, merge or deploy.
- Never mint a real ticket number; use `IOS-` step IDs.

---

## 13. Co-Development Transition

When the owner activates the iOS track:

1. **Web stays primary.** Product behavior is still decided and specified on web first.
2. **The every-other-day refresh stops.** Each new web or Mac ticket gains a real **iPhone
   implementation** line beside its web and desktop lines, replacing "Future mobile:
   deferred".
3. **Changes cascade in real time.** A feature ticket lands web, Mac and iPhone in the
   same release train where possible, or names its iPhone follow-up ticket. The interaction
   registry's mobile status moves from `deferred` to `implemented` in the same change.
4. **Shared code first.** New rules land in `@cadence/core` so all three clients pick them
   up; Swift code stays presentation and platform glue.
5. **iOS-only surfaces** (Live Activities, widgets, Siri, Watch) get their own tickets and
   are checked for each new feature: "does this need a Live Activity, widget or intent
   change?" becomes a line in the ticket template.
6. This file then becomes the starting map for the implementation tickets and is archived
   once they exist.
