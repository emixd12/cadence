# 02 · iPhone-Native Features (v1.0) and Future Roadmap

> **Status:** Part of the running iOS blueprint (`docs/IOS_PLAN.md`). Not authorized for
> implementation. No iOS code, real ticket or ticket number exists. Mobile work stays out
> of scope in `AGENTS.md` until the owner activates the track.
>
> **Synced through:** `19d73443` (`origin/main`, November 27, 2026).
>
> **Scope of this file:** surfaces that exist only on iPhone. Everything that mirrors web
> lives in `01-port-map.md`. Product choices here were made by the owner on November 25,
> 2026 (`docs/DECISIONS.md`, "Modular iOS blueprint, v1.0 product scope, and
> every-other-day refresh"). API names and platform limits are written from Apple
> documentation as known in October–November 2026 and are **not re-verified**; each one
> marked *(recheck)* joins the Claims Ledger in `07-build-phases.md`. `IOS-` IDs are
> plan-local step labels, not ticket numbers.

---

## 0. Rules every iPhone-native surface follows

1. **One write path.** Every mark, note, timer or Opportunity action from a Live
   Activity, widget, Control, notification, Siri or Shortcut runs an App Intent in the
   **main app process**, which writes to local SQLite plus the outbox through the same
   operations as the Timeline (`04-accounts-sync-offline.md`). Extensions never write.
2. **Same domain rules.** Status changes go through the shared status rules: Completed
   auto-stops a running timer (Ticket 351); nothing marks Not Completed automatically;
   nothing writes "missed"; a resolved status can be changed later.
3. **Command contract.** Each write carries `expectedStatus` and a fresh `commandId`. A
   stale tap (the Occurrence was marked on the Mac a minute ago) is refused with the
   catalog notice, never applied twice.
4. **Words from the catalog.** Button labels use the Timeline's words: **Completed**,
   **Not Completed**, **Note**, **Stop**. Notice text comes from the notices catalog.
5. **Privacy first on shared screens.** Any surface visible on a locked phone honours the
   **Lock Screen privacy** setting (Section 4.3): when on, Behavior titles and notes are
   replaced by a neutral placeholder.
6. **Accessibility.** Status is never shown by colour alone: every state carries its word
   or a symbol with an accessibility label. All surfaces are tested with VoiceOver, Large
   Text and Reduced Motion.

---

## 1. Live Activities (v1.0)

Three kinds share one `ActivityAttributes` family in a `CadenceLiveActivity` widget
extension: **Active Timer**, **Upcoming / Due Behavior**, and **Routine** (a variant of
Upcoming / Due). Each renders on the Lock Screen, in the Dynamic Island (compact, minimal,
expanded) and, through the `.small` supplemental family, in the Apple Watch Smart Stack
and on CarPlay *(recheck)*.

### 1.1 Active Timer Live Activity

**Product behavior**

- **Starts automatically** when the person taps **Track Time** in the app, or starts a
  timer from Siri, a Shortcut or the Start / Stop Control. The app is in the foreground
  or running the intent, so a local `Activity.request` works.
- Shows the **Behavior title** and the elapsed time as `Text(timerInterval:
  start...distantFuture, countsDown: false)` in a fixed-width frame with
  `.monospacedDigit()`, so the layout does not jump as digits change.
- Buttons: **Stop** (stops the session; status unchanged) and **Complete** (marks the
  Occurrence Completed, which stops the timer per Ticket 351, then ends the activity with
  a short "Completed" final state).
- Dynamic Island: compact leading = small Cadence mark, compact trailing = elapsed time;
  expanded = title, elapsed time, Stop and Complete.
- One timer activity per running session. Starting a second timer in Cadence starts a
  second activity; both are subject to the system's per-app cap (Section 1.4).
- Turning the timer off elsewhere (Timeline, Mac, web) ends the activity on the next
  sync or push update.

**Platform limits**

- A Live Activity can stay active for **8 hours**; the system then ends it and it may stay
  on the Lock Screen up to **4 more hours (12 h total)** *(recheck)*. Cadence's timer
  session keeps running after that. When the app next opens, the Timeline still shows
  the running counter, and the app does **not** restart the activity automatically after
  the 8 h end (it would hit the cap again and add noise).
- Elapsed time is rendered by the system from the start date. No per-second updates are
  sent.

### 1.2 Upcoming / Due Behavior Live Activities (on by default)

**Product behavior**

- Every **timed** Behavior Occurrence (a clock time or a time range) shows a Live Activity
  shortly **before** its scheduled start. Default lead: **15 minutes** before a clock time
  and at the start of a preset range (Morning, Afternoon, …). The lead window is a single
  product constant (range 15–30 minutes) to tune in dogfood; it is not a user setting in
  v1.0.
- Untimed and Opportunity Behaviors (no fixed schedule) get no upcoming activity.
- The card shows the title, the time ("9:00 AM" or "Morning"), the state ("Starts in
  12 min" via `Text(timerInterval:countsDown: true)`, then "Now"), and two buttons:
  **Completed** and **Not Completed**. Tapping the card body opens that Occurrence in the
  Timeline, expanded.
- It **stays until** the Occurrence is marked Completed or Not Completed (from the card,
  the app, a notification, Siri, the Mac or web), or until **local midnight**, when the
  Occurrence joins Needs decision, whichever comes first. The 8 h system limit also ends
  it (a 9:00 AM item would end around 5:00 PM). Ending never writes a status.
- Marking on the card shows the result briefly ("Completed", with the chime suppressed on
  the Lock Screen and a success haptic) and then dismisses the activity
  (`.dismissalPolicy(.after(now + a few seconds))`).
- A Behavior with a running timer shows the **Active Timer** card instead of a second
  upcoming card for the same Occurrence.
- When several items are due inside the same window, Cadence shows **one card per
  Occurrence up to the cap**; past the cap it shows one stacked card ("Up next: Gym and 2
  more") that opens the Timeline (Section 1.4).

**Clutter controls**

- **Global switch:** Settings → This iPhone → **Live Activities for upcoming Behaviors**,
  default **on**. Off ends every upcoming activity at once and stops the server sending
  push-to-start for this device.
- **Per-Behavior toggle:** Behavior editor → **Show Live Activity before it starts**,
  default **on**. Synced with the Behavior so every phone of the account obeys it.
  (Field addition is a sync contract and schema change, made at activation.)
- The system's own per-app Live Activities switch (Settings → Cadence) always wins;
  Cadence shows its state on the This iPhone row.

### 1.3 Routines in Live Activities

- A routine slot shows **one card**, not one per step: routine title, slot time, derived
  progress ("1/3") and one action, **Complete routine**, which marks every Unresolved step
  in that slot Completed (the same bulk mark as the Timeline parent row; running timers on
  those steps stop).
- **Not Completed** for a whole routine is not offered on the card: it is rare and easy
  to mis-tap. The person uses the app.
- When only part of the routine was done, tapping the card opens the Timeline with that
  routine **expanded at All steps**, so each step can be marked.
- Progress updates when any step is marked anywhere. The card ends when every step is
  resolved, at local midnight, or at the 8 h limit.

### 1.4 Delivery mechanism and platform constraints

**Constraints Cadence designs around** *(all recheck)*

| Limit | Effect on the design |
|---|---|
| 8 h active, 12 h total on Lock Screen | Timer and upcoming cards end on their own; ending never changes data. |
| ~4 KB payload for `ContentState` and push updates | Content holds IDs, title (or nothing when redacted), times, state enum and progress counts only. No notes. |
| No network inside the widget extension | The extension only renders. All updates come from the app (local `activity.update`) or from APNs pushes. |
| Buttons run a `LiveActivityIntent` in the app process | The app launches in the background to write; this works after first unlock. |
| Locked phone | Mark intents set an authentication policy that asks for Face ID / passcode on a locked phone before they run (`authenticationPolicy = .requiresAuthentication`) *(recheck name)*. The card still shows on the Lock Screen; only the action asks. |
| No starting from the background | An app in the background cannot call `Activity.request`. Automatic upcoming activities therefore use **APNs push-to-start**, with foreground-scheduled starts as the fallback. |
| Per-app simultaneous activity cap (observed ~5) | Cadence keeps at most **one timer + three upcoming** cards per device and coalesces the rest into the stacked card. |
| Push budget | The system limits frequent high-priority updates. Cadence sends only start, state change and end; no countdown pushes. |

**How upcoming activities start**

1. **Push-to-start (primary).** On launch the app registers its
   `Activity<…>.pushToStartTokenUpdates` token with the hosted server, per device. A
   hosted job (a sibling of the existing reminder processing, reading the same
   `reminder_deliveries`-style planning) sends an APNs `liveactivity` push with
   `event: start` at lead time for each eligible Occurrence: global switch on for that
   device, per-Behavior toggle on, Occurrence still Unresolved, not redacted beyond what
   the payload allows. This works with the app closed.
2. **Foreground-scheduled start (fallback).** Whenever the app is in the foreground it
   reconciles the next few hours: it starts any activity whose lead time has arrived and
   that the server did not start (offline, push failed), and, where the OS supports a
   scheduled start date for `Activity.request` *(recheck)*, schedules the ones due later
   today.
3. **Updates and ends.** Each started activity reports its `pushTokenUpdates` token to the
   server. When the Occurrence is marked on any client, the server sends `event: end`
   with the final state. The app also ends it locally when it learns of the mark through
   sync.
4. **Idempotency.** Activities are keyed by Occurrence ID; the app ends duplicates; the
   server records one start per Occurrence per device, in the same idempotent way as
   reminder deliveries.
5. **Offline phone.** If the phone was offline when a Behavior was edited locally, the
   server may not know the new time. The foreground reconcile ends any activity whose
   Occurrence no longer matches local data.

**Privacy and redaction**

- With **Lock Screen privacy** on, the server sends **no title** in the push payload; the
  card reads "Behavior due · 9:00 AM" on the Lock Screen and fills the title only when
  rendered unlocked (`.privacySensitive()` with a neutral placeholder).
- Push payloads never carry notes, categories, places or descriptions.
- Server data stored for this feature: device push tokens and per-Occurrence start/end
  records. Logged in `docs/MESSAGING_CHANGES.md` and the privacy label at activation.

---

## 2. Siri, Shortcuts and Spotlight (v1.0)

### 2.1 Structure

- One Swift package, **CadenceIntents**, holds every `AppIntent`, `AppEntity`
  (`BehaviorEntity`, `OccurrenceEntity`, `OpportunityEntity`) and `AppShortcutsProvider`.
  It is linked by the app, the widget extension and the Live Activity extension so every
  surface runs the same code.
- Intents that write declare execution in the **main app** (`IntentExecutionTargets =
  .main`) *(recheck name)* and use `supportedModes` to say whether they run in the
  background or bring the app forward *(recheck)*.
- **Every App Shortcut phrase contains `\(.applicationName)`**, as Apple requires.
- Entities resolve by title with `EntityStringQuery`; ambiguous titles ask "Which one?"
  with a short list.
- **App Intents Testing** runs in CI against an in-memory store (`07-build-phases.md`).

### 2.2 v1.0 intents

| Intent | Example phrase | Behavior |
|---|---|---|
| **Mark Completed** | "Mark Take medication completed in Cadence" | Picks today's earliest Unresolved Occurrence of that Behavior (else the most recent Needs decision one, after confirming the date). Writes Completed; stops a running timer. Conforms to `UndoableIntent` *(recheck)* so "Undo" reverts if Siri misheard. |
| **Mark Not Completed** | "Mark Gym not completed in Cadence" | Same selection; asks for confirmation on a past date. Undoable. |
| **Add a note** | "Add a note to Reading in Cadence" | Prompts for text; appends to the Occurrence's note with `expected_note` protection. Day-note variant: "Add a day note in Cadence". |
| **Start timer / Stop timer** | "Start the Reading timer in Cadence" | Same rules as Track Time; Start also starts the Active Timer Live Activity. |
| **Add an opportunity to today** | "Add Stretching to today in Cadence" | Opens the time choice (Exact time at the suggested time, or a time window); "I just did Stretching in Cadence" runs **Done now**. |
| **What's left today?** | "What's left today in Cadence?" | Spoken and snippet list of today's Unresolved items in time order; no write. |
| **What needs a decision?** | "What needs a decision in Cadence?" | Count and day-grouped list of prior Unresolved items; snippet offers Open Needs decision. |
| **Daily Brief summary** | "What's my Daily Brief in Cadence?" | When a brief is ready, reads a short summary (the teaser plus the number of proposed moves). Read-only: accepting or declining moves happens only in the app; the snippet's button opens the Brief. When no brief is ready or AI features are off, says so with the catalog notice. Needs network. |
| **Open …** | "Open Needs decision in Cadence" | Open Timeline, Needs decision, Chat, or a specific Behavior (`OpenIntent` with a `BehaviorEntity`). |
| **Export** (optional) | "Export my Cadence history" | A long-running export intent *(recheck `LongRunningIntent`)* producing a JSONL or BehaviorLog file the Shortcut can pass on. |

Rules: every write intent shows a result snippet with the catalog wording, works offline
(local write, sync later) except the Daily Brief summary, and never runs a hosted AI call
except reading an already-built brief.

Periods (D35) have no intent yet. Whether v1.0 adds "Start a period" and "End a period"
App Shortcuts is open (`docs/IOS_PLAN.md`, Open Questions inbox, Q3). Until answered,
Periods stay in the app.

### 2.3 Spotlight

- Index running **Behaviors** (title and category; never notes, descriptions or places)
  as `IndexedEntity` / Core Spotlight items. A result opens that Behavior; Siri
  Suggestions can surface the Open and Mark intents.
- Settings → This iPhone → **Show Behaviors in Spotlight**, default **on**. Turning it off
  calls `deleteAllSearchableItems` at once and stops indexing.
- With Lock Screen privacy on, Spotlight still indexes (Spotlight results need an unlocked
  phone) unless the person turns indexing off.
- Archived and ended Behaviors are removed from the index.
- Periods are not indexed (labels such as "Sick" can be sensitive); Q3 in
  `docs/IOS_PLAN.md` asks the owner to confirm.

---

## 3. Widgets and Controls (v1.0)

### 3.1 Home Screen widgets

| Widget | Content | Interaction |
|---|---|---|
| **Small** | Configurable: **Next up** (next Unresolved item, its time) or **Today** (done / total as words and a ring, e.g. "4 of 7 done") | Tap opens the Timeline at that item. |
| **Medium (interactive)** | Next 2–3 Unresolved items today with their times and a **Completed** button each | Buttons run the Mark Completed intent in the main app (`.main`); the row shows a pending state through `invalidatableContent()` until the timeline reloads. |

### 3.2 Lock Screen widgets

- **Rectangular:** next item and its time, plus "3 left today".
- **Inline:** "Next: Gym 6:00 PM" or "4 of 7 done".
- Both redact the title under Lock Screen privacy.

### 3.3 Controls (Control Center, Lock Screen, Action Button)

1. **Complete [picked Behavior]** — an `AppIntentControlConfiguration` whose Behavior is
   chosen when the control is added (`promptsForUserConfiguration()`). One tap marks the
   **earliest Unresolved eligible Occurrence today** of that Behavior Completed. When none
   is left the control shows "Done for today" and the tap opens the Behavior.
2. **Start / Stop Timer** — a `ControlWidgetToggle` backed by a `SetValueIntent` that also
   acts as a `LiveActivityIntent`, so starting it starts the Active Timer Live Activity.
   The Behavior is chosen at setup.

Both Controls appear on a paired Apple Watch automatically through the iPhone
(`03-apple-watch.md`).

### 3.4 Mac desktop

- **iPhone widgets on the Mac desktop are disabled** (owner decision): every widget uses
  `.disfavoredLocations([.iPhoneWidgetsOnMac], for: …)` *(recheck)*. Cadence for Mac covers
  the Mac.

### 3.5 Rendering and accessibility checklist

- Status never by colour alone; every state shows its word or a labelled symbol.
- Test **accented**, **clear / tinted**, **vibrant** (Lock Screen), **luminance-reduced**
  (Always-On) and **StandBy night** modes. Mark the brand mark and status ring
  `widgetAccentable()`.
- Titles use `.privacySensitive()`.
- Extensions are **read-only**: they read a small read model (next items, counts) that
  the app writes to the App Group container after each change. They never open the main
  SQLite file for writing.
- Stay inside the widget extension's memory budget (plan for ~15 MB of working memory
  *(recheck)*): no JS runtime, no images beyond the asset catalog.
- Debounce `WidgetCenter.reloadTimelines` and `ControlCenter.reloadControls` to one call
  per burst of changes; timeline entries at each item's start time so "Next up" rolls
  forward without a reload.

---

## 4. Notifications, Travel and Location (v1.0)

### 4.1 Local reminder horizon

Mirrors the Mac rules (`docs/DESKTOP_BUILD.md`; `AGENTS.md`, "Reminder rules"):

- Behavior reminders are on by default; email reminders keep the hosted rules and stay
  off by default.
- Plan **nearest-first** toward a 30-day target, within iOS's **64 pending local
  notifications** cap *(recheck)*, keeping a small **reserve** for leave reminders and
  one "open Cadence to keep reminders coming" note at the end of the horizon.
- After scheduling, **read back** `pendingNotificationRequests` and compute contiguous
  coverage. Settings shows **"Reminders scheduled through {date}"**; when coverage is
  shorter than 7 days a Timeline notice says so, from the catalog.
- Top up opportunistically with `BGAppRefreshTask` and on every foreground; never rely on
  background runs.
- Persist planned and delivered evidence in SQLite, like Mac's coverage records.
- Cancel pending reminders when an Occurrence is resolved before its reminder.

### 4.2 Actionable notifications

- Category actions: **Completed**, **Not Completed**, **Add Note** (a text-input action).
- Completed and Not Completed run without opening the app, after first unlock. **Add
  Note** requires authentication on a locked phone (`.authenticationRequired`); when the
  Occurrence already has a note, Add Note opens the Occurrence in the app instead of
  overwriting.
- `threadIdentifier` = Behavior ID, so a Behavior's reminders group together.
- **No app icon badge.**
- **Permission:** asked once, in context, right after the first Behavior is saved
  ("Get a reminder when Take medication is due?"), never during onboarding. Denied
  permission leaves the app fully usable and Settings shows how to turn it on.
- Notifications show the chime-free system sound; the completion chime plays only for
  in-app marks.

### 4.3 Lock Screen privacy

- Settings → General → Notifications → **Hide Behavior names on the Lock Screen**, default
  off. When on, notification text, Live Activities and Lock Screen widgets show "Behavior
  due" instead of the title; the content appears after unlock.

### 4.4 Reminders on this device

- Settings → General → Notifications → **Reminders on this device**, default on, **not
  synced**. Turning it off on the iPhone stops this phone's reminders so a person who
  keeps the Mac open is not reminded twice. Live Activities follow their own switch.

### 4.5 Travel, leave reminders and location

- Location permission is **"While Using the App" only** in v1.0, matching web and Mac. No
  background location, no "Always" request, no region monitoring or geofencing, no
  significant-change service.
- Device position is read only while the app is open: for travel origin, **Use my current
  location** for Home, and completion place labels (Ticket 216). No positions, route
  durations or Google event details are stored on the server (`AGENTS.md`, "Security
  rules").
- **Leave reminders** (D3): off by default; when on, the hosted leave-reminder job sends
  them through **APNs** (the iPhone replaces web push), and the app also schedules local
  leave notifications from the last estimate as Mac does. One reminder per trip, one
  update only if leave time moves 10 minutes or more earlier. Leave reminders sit outside
  the Behavior reminder coverage count.
- Travel estimates without location permission keep working from Home or the previous
  stop, as on web.

---

## 5. Future iPhone-Specific Roadmap (post-v1, scoped only)

None of these ships in v1.0. Each needs an owner decision before it gets a ticket.

### 5a. Context-collection micro-prompts in Live Activities

- After a mark on a Live Activity, or inline on the card, ask one quick question with two
  or three buttons, then dismiss:
  - "Done just now / earlier?" (sets completion time, the "Done at · Just now · Other
    time" pattern);
  - "At Home?" (confirms the completion place label);
  - "Can this be done alongside other things?" (writes the D33 setting).
- At most one question per card, only when the answer is missing, and never on a
  redacted Lock Screen. Start after v1.0 Live Activity use has been dogfooded, so the
  cards stay uncluttered.

### 5b. Deeper Siri, Cadence advisor and Apple Intelligence

- Let Siri hand a question to Cadence Chat ("Ask Cadence why I keep skipping Gym") and
  read back the answer, with writes still confirmed in the app.
- Evaluate Apple Intelligence on-device models (Foundation Models) for small tasks such as
  note shortcut extraction or brief summaries against Cadence's hosted advisor pipeline,
  comparing quality, privacy, cost and parity with web and Mac. Hosted rules (context
  building, output validation) stay authoritative.

### 5c. Optional Always-On location and geofencing

- An opt-in exploration of "Always" location and region monitoring for: automatic place
  confirmation, arrival-based nudges ("You're at the gym"), and leave-by alerts that
  adjust while the app is closed.
- Requires its own privacy and battery review, App Store review of purpose strings, a
  change to the `AGENTS.md` out-of-scope list ("Background location tracking") and
  messaging entries. Off by default and removable at any time.

---

## 6. Platform impact and messaging

- Web: hosted additions at activation only (push-to-start token registration, Live
  Activity push job, APNs leave-reminder channel, per-Behavior Live Activity field).
  None now.
- Desktop: the per-Behavior Live Activity field syncs through the account sync contract
  at activation; the Mac shows nothing for it.
- Marketing: not applicable until the launch messaging pass.
- Future mobile: this file.
- Messaging impact: none now. At activation, log entries for APNs push tokens, Live
  Activity payload contents, Spotlight indexing and Lock Screen privacy.
