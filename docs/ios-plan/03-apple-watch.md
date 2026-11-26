# 03. Apple Watch

Part of the running iOS blueprint. The hub is `docs/IOS_PLAN.md`. This file is
not a source-of-truth document and authorizes nothing. No watchOS code, target,
ticket or ticket number exists. Mobile and watch work stay out of scope in
`AGENTS.md` until the owner activates the track (`docs/DECISIONS.md`,
2026-11-18 and 2026-11-25).

Step IDs such as `IOS-201a` are plan-local. They are not ticket numbers. Real
ticket numbers are allocated at activation.

Baseline: the October 15, 2026 proposal (`docs/IOS_PLAN.md` at `64b78b80`,
Part B, Sections 2.2, 4.3, 4.6, 5.2, 5.3, 5.5, 7.4, 8, 10.1, 12 and 16), with the
owner decisions of November 18 and November 25, 2026.

## 1. Principle

The Apple Watch app is a distinct feature, planned on its own (owner principle
4, November 18, 2026). It does not gate the iPhone release.

Two layers follow from that:

| Release | What the watch gets | watchOS target |
|---|---|---|
| v1.0 | Automatic support from the iPhone app: mirrored actionable notifications, Live Activities in the Smart Stack, iPhone Controls on the watch | None |
| v1.1 (fast follow) | Dedicated native watchOS app: glance-and-tap companion | Watch app and watch widget extension |

Much of the watch's value comes from the iPhone app alone. Ship that layer
first. Build the watch app as its own milestone (Part B, Section 17.1).

## 2. v1.0: automatic watch support

v1.0 ships no watchOS target. Every item below runs on the iPhone and appears on
a paired watch through system mirroring.

### 2.1 Mirrored actionable notifications

- Behavior reminders mirror to the watch when the iPhone is locked or idle.
  Their actions are the iPhone's actions, in the same order: Completed, Not
  Completed, Add Note.
- Background notification actions run on the target device, the iPhone.
  Completed and Not Completed are background actions. They run in the iPhone
  app's process through the notification delegate wired in the app delegate
  (`docs/ios-plan/04-accounts-sync-offline.md`, Section 7).
- Foreground actions run on the device where the person selects them. Add Note
  is a text-input action; on the watch it opens watch text input, and the iPhone
  receives the text as the response.
- Each action carries the command contract (Section 5): `commandId`,
  `capturedAt`, `expectedStatus`, `expectedLatestEventId`. Add Note also carries
  `expectedNote`. If a Note already exists, the action rejects and the iPhone
  opens the Occurrence on next launch (Part B, Section 4.6).
- `threadIdentifier` per Behavior groups the stack.
  `hiddenPreviewsBodyPlaceholder` keeps redacted text consistent with the Lock
  Screen privacy setting.
- Double Tap on a notification triggers its first action (Completed). It works
  only on Series 9, Ultra 2 and later.
- Before first unlock after an iPhone reboot, protected data is unavailable. The
  action reports failure. It never claims success. No API redelivers a
  notification response.

### 2.2 Live Activities in the Smart Stack

The iPhone's Live Activities appear in the watch Smart Stack through the
`.small` activity family. Design the `.small` layout for both activity kinds:

| Activity | Starts | Watch `.small` content | Button |
|---|---|---|---|
| Timing (active timer) | Starting time tracking in the iPhone app, in the foreground | Behavior name and `Text(timerInterval:)` in a constrained frame | Stop, a `LiveActivityIntent` that names its session |
| Upcoming or due Behavior | Opt-in, scheduled from the foreground (iOS 26 scheduled starts) | Behavior name, scheduled time, status | Completed, a `LiveActivityIntent` with the command contract |

Constraints carried from Part B, Section 2.2:

- Live Activities stay active 8 hours and on the Lock Screen 12 hours. Data is
  limited to 4 KB. Activities have no network access.
- The timing activity ends at 8 hours. The session continues in Cadence.
- Scheduled starts need an alert configuration and count toward the
  simultaneous limit. The reminder notification stays.
- Background starts need a `LiveActivityIntent`, a push or a schedule. A timer
  started from a notification or the watch cannot start an activity; the next
  foreground launch offers it.
- `LiveActivityIntent` runs in the app's process, so the button writes through
  the single iPhone writer.
- Live Activity buttons are inactive on a locked iPhone until the person
  authenticates. Not verified for the watch Smart Stack: check on paired
  hardware in `IOS-201a`.
- Status never relies on color alone. Check the luminance-reduced (Always-On)
  rendering.

### 2.3 iPhone Controls on Apple Watch

On watchOS 26 and later, iPhone Controls appear on Apple Watch and run on the
iPhone (WWDC25 session 334, cited by the October platform review).

- "Complete [Behavior]": `AppIntentControlConfiguration` with
  `promptsForUserConfiguration`. The engine picks that Behavior's earliest
  Unresolved eligible Occurrence today. That pick is a new core rule with tests
  (Part B, Section 5.3).
- "Start/Stop Timer": `SetValueIntent` plus `LiveActivityIntent`. Stop names its
  session.
- Both run with `allowedExecutionTargets = .main`, so the write happens in the
  iPhone app process. `authenticationPolicy` is chosen per intent.
- Each trigger that marks an Occurrence Completed is another trigger of
  `INT-TIMELINE-005` (Part B, Section 3.2).

### 2.4 v1.0 acceptance on the watch

From Part B, Section 10.1, with the watch rows kept:

- Force quit the iPhone app, then a notification action from the watch.
- Notification action on a locked iPhone after first unlock, and before first
  unlock.
- Controls on the watch with the iPhone locked.
- Timing Live Activity Stop from the Smart Stack.
- Double Tap on a Series 9 or later watch; confirm no Double Tap path on a
  Series 6–8 watch.

## 3. v1.1: dedicated native watchOS app

### 3.1 Product scope (Owner Decision B, 2026-11-25)

The watch app is a fast, glance-and-tap companion.

In scope:

| Feature | Notes |
|---|---|
| Today's list | From the `watch.json` read model. Includes Routine summary rows |
| Needs decision list | Prior-day Unresolved Occurrences, derived by the engine on the iPhone. Includes Routine summary rows |
| Mark Completed or Not Completed | One tap. Works offline on the watch through the local command queue. Shows "Pending" until the iPhone confirms |
| Start / Stop Timer | Start names the Occurrence. Stop names its session (`expectedSessionId`) |
| Voice-dictated quick Notes | On an Occurrence or on a day. Owner chose this in Round 2 (2026-11-25). Native watchOS dictation and text input (`TextField` or the system dictation sheet). Queued through the command contract with `expectedNote` |
| Watch face complications | Next Behavior, count left today, running timer |
| RelevanceKit Smart Stack cards | Next due Behavior; running timer |
| Double Tap | One primary action per screen (Section 3.4) |

Out of scope on the watch:

- Behavior creation and editing.
- Advisor Chat.
- Daily Brief reading and Daily Brief moves.
- Settings.
- Analytics.
- Export and Import.
- Independent cloud sync without the iPhone. The watch never talks to Supabase.
  It inherits the iPhone's account (Part B, Section 3.5).

### 3.2 Screens

| Screen | Content | Primary action (Double Tap) |
|---|---|---|
| Today | Rows in day order: Behavior name, time, status. Routine rows show a summary ("3 of 5") and open the Routine | Completed on the focused row |
| Needs decision | Prior-day Unresolved rows, grouped by day, newest first | Completed on the focused row |
| Occurrence detail | Name, time, status, Note preview; buttons Completed, Not Completed, Timer, Note | Completed |
| Running timer | Elapsed time, Behavior name | Stop |
| Note entry | Dictation or text input; existing Note shown read-only first | Save |

Each row's result after a tap (status, tone, group) comes precomputed in the read
model. The watch shows it immediately and never decides a status rule
(`docs/ios-plan/04-accounts-sync-offline.md`, Section 9).

### 3.3 Voice-dictated quick Notes

- Input: SwiftUI `TextField`, which offers dictation, Scribble and the
  keyboard on supported models. The system dictation sheet is the fallback.
  Speech recognition runs in the system; Cadence adds no speech feature and no
  audio recording (speech features stay out of scope in `AGENTS.md`).
- Target: an Occurrence Note or a day Note. Both already accept an expected
  value in core: `updateOccurrenceNote({ occurrenceId, expectedNote, note })`
  and `DayNoteSaveCommit { localDate, expectedNote, note }`
  (`packages/core/src/data-store.ts:111-125`).
- Command: the watch sends `expectedNote` equal to the Note it showed (or
  `null`).
- Conflict: if the iPhone's current Note differs from `expectedNote`, the
  command rejects. The watch keeps the dictated text, shows "Note changed on
  another device" and offers "Add to end" or "Discard". "Add to end" sends a new
  command whose `expectedNote` is the current Note and whose `note` appends the
  dictated text on a new line. The watch never overwrites a Note silently.
- Size: cap dictated text before queueing, well under the
  `transferUserInfo` and `sendMessage` payload limits. The exact cap is set in
  `IOS-201b`.
- Privacy: Note text is user content. Mark it `privacySensitive()` and never
  log it.

### 3.4 Double Tap

- One primary action per screen, set with `handGestureShortcut(.primaryAction)`.
- Watch app Double Tap needs Series 9, Ultra 2 or later. Every action stays
  reachable by touch.

### 3.5 Complications and Smart Stack

- Watch widget extension renders from `watch.json` only. No engine runs on the
  watch.
- Families: circular, rectangular, inline, corner. Status never relies on
  color alone; test tinted and luminance-reduced modes.
- RelevanceKit cards: the next due Behavior near its time; a running timer while
  it runs.
- Reloads follow each new `watch.json`. The budget comparison is in Section 4.4.

## 4. Technical architecture

### 4.1 Verified constraints

- watchOS has neither JavaScriptCore nor WebKit (Part B, Section 2.2). The
  TypeScript core cannot run on the watch.
- The watch therefore renders compact snapshots and sends commands. Every rule
  runs in the iPhone's tracking engine.
- An independent watch sync client is out of scope (Part B, Section 3.5).

### 4.2 Data flow

```text
iPhone app process (single writer)
  EngineHost -> commit -> ReadModelWriter -> watch.json
  WatchBridge (WCSession)
     updateApplicationContext(watch.json)   ----> Watch app: cache + render
     <---- sendMessage(command)                   (wakes iPhone app when reachable)
     <---- transferUserInfo(command)              (queued when not reachable)
     replyHandler / reply transfer(result) ---->  Watch: clear "Pending"
```

- Snapshot down: `updateApplicationContext` carries the latest `watch.json`.
  Only the newest context is delivered, which suits a snapshot.
- Commands up: `sendMessage` when `isReachable`. `sendMessage` from an active
  watch app wakes the iPhone app in the background.
- Queued commands: `transferUserInfo` when not reachable. The system delivers
  them in order, and they survive app exit.
- `transferUserInfo` does not work in Simulator. Watch transfer evidence needs
  paired hardware (`IOS-201a`).
- The iPhone activates `WCSession` in the app delegate, never in `onAppear`,
  because background launches create no scenes.

### 4.3 Command contract on the watch

The watch uses the shared contract
(`docs/ios-plan/04-accounts-sync-offline.md`, Section 8):

```ts
{
  commandId,               // UUID minted on the watch; replay returns the prior result
  capturedAt,              // watch clock at the tap
  expectedStatus,          // status the watch showed
  expectedLatestEventId,   // latest event the watch showed
  expectedSessionId?,      // timer stop names its session
  expectedNote?,           // dictated Note: the Note the watch showed, or null
  watchContractVersion     // see "Versioning" below
}
```

Rules:

- One outstanding command per Occurrence. A second tap on a row with a pending
  command is disabled until the first resolves.
- The iPhone store returns a prior result for a known `commandId`. A lost reply
  followed by a `transferUserInfo` retry applies exactly one event.
- Same status already current: success. Different status current: reject with
  "Already marked elsewhere", and the watch shows the current status.
- Clock skew: completion and timing instants use `capturedAt`, clamped between
  the read model's `generatedAt` and the iPhone's now. Test with the watch clock
  ±2 minutes.
- A queued tap applied after midnight keeps the tap time as its completion
  time. The Occurrence keeps its own `local_date`.
- Pending state: the watch shows "Pending" on the row until the iPhone's result
  arrives. A rejection replaces it with the current status and a short reason.

Versioning, both ways:

- `watch.json` carries `schemaVersion`. Commands carry `watchContractVersion`.
- iPhone N+1 with watch N: the iPhone keeps accepting version N commands and
  writes a version N snapshot when the watch reports N.
- iPhone N with watch N+1: the watch falls back to version N fields. If it
  cannot, it shows "Update Cadence on your iPhone" and sends no commands.
- Both cases are acceptance scenarios (Section 6).

### 4.4 Background refresh and complication budget

- Complete each `WKWatchConnectivityRefreshBackgroundTask` only after
  `WCSession.hasContentPending` is false. Completing early drops pending
  transfers.
- `IOS-201a` compares two delivery paths for complication freshness:
  - `transferCurrentComplicationUserInfo`: a reported limit of 50 a day, and
    only with a Cadence complication on the active face. The limit is from the
    October expert review and was not rechecked.
  - `updateApplicationContext`: no stated daily limit; delivered when the
    system chooses.
- Precompute several upcoming local midnights in `watch.json`, so the list and
  complications regroup at midnight without the iPhone running.

### 4.5 Reachability and unlock

- When `iOSDeviceNeedsUnlockAfterRebootForReachability` is true, show "Unlock
  your iPhone". Queue commands; do not mark them failed.
- When the iPhone is unreachable for a long time, show the snapshot's
  `generatedAt` age once it passes the read model's `validUntil`.

### 4.6 Minimum watchOS

- watchOS 26 if a watchOS 26 watch pairs with an iOS 27 iPhone. Forum reports say
  yes; no Apple document confirms it. Confirm on paired hardware in `IOS-201a`.
- Otherwise watchOS 27. watchOS 27 drops Series 6–8, SE 2 and the original
  Ultra.
- Test devices: a Series 9 or later watch, and a Series 6–8 watch on watchOS 26
  (Part B, Section 13, item 3).

### 4.7 Project layout

From Part B, Section 4.9:

```text
apps/ios/
  CadenceWatch/            watch app entry (v1.1)
  CadenceWatchWidgets/     watch widget entry (v1.1)
  Packages/CadenceKit/     shared Models, DesignSystem, ReadModels, WatchBridge
```

- Proposed identifiers: `app.cadence.ios.watchkitapp` and
  `app.cadence.ios.watchkitapp.widgets`. Identifiers lock at first upload;
  register them only after the membership decision.
- Keep `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` identical across all
  targets.
- Privacy manifests in the watch app and the watch widget extension.
- System fonts in complications.

## 5. Acceptance (v1.1)

From Part B, Section 10.1, with watch-specific additions:

1. Force quit the iPhone app, then a watch tap: the iPhone wakes and commits.
2. Watch reply lost, then a `transferUserInfo` retry: exactly one event.
3. Queued watch tap applied after midnight: completion time equals tap time.
   Repeat with the watch clock ±2 minutes.
4. iPhone N+1 with watch N, and the reverse.
5. Dictated Note while the iPhone edits the same Note: the watch shows the
   conflict and never overwrites.
6. Timer started on the watch, stopped on the iPhone, then a stale Stop from the
   watch: rejected by `expectedSessionId`.
7. iPhone rebooted and locked: the watch shows "Unlock your iPhone" and queues.
8. Account deleted on the iPhone: the watch cache is cleared
   (`docs/ios-plan/04-accounts-sync-offline.md`, Section 4).
9. Paired matrix on watchOS 26 and watchOS 27.

All watch transfer evidence comes from paired hardware. Simulator evidence is
functional only.

## 6. Steps

| Step | Content | Exit |
|---|---|---|
| `IOS-201a` | Paired-hardware proof: watchOS 26 with iOS 27 pairing; `sendMessage` wake; `transferUserInfo` ordering; complication budget comparison; Smart Stack button behavior on a locked iPhone | Recorded results; minimum watchOS chosen |
| `IOS-201b` | Watch app: Today, Needs decision, mark, timer, dictated Notes, command queue | Section 5 rows 1–7 PASS on hardware |
| `IOS-201c` | Complications and RelevanceKit Smart Stack cards | Rendering modes checked |
| `IOS-201d` | Notifications and Double Tap | Series 9+ and Series 6–8 checked |

## 7. App Store listing

- Write "Cadence for Apple Watch" in the listing (Part B, Section 7.4).
- Describe every extension in the listing.
- Add Apple Watch screenshots, with fictional data, when v1.1 ships.

## 8. Open items

- Whether Live Activity buttons in the watch Smart Stack follow the locked-iPhone
  rule. Not verified.
- The dictated Note length cap.
- Whether the "upcoming or due" Live Activity ships in v1.0 or v1.0.x. Part B
  listed it as a v1.0.x option.
