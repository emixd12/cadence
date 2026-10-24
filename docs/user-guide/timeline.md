# Timeline, statuses, and Notes

Timeline begins with the current local day and is the primary daily screen. It
shows the next seven days by default. Prior-day Unresolved Occurrences are kept
out of the forward feed and appear in **Needs decision**.

## Daily Brief

When this Cadence server supports Daily Brief, enable it in **Settings**.
Cadence sends today's Behavior schedule and bounded completion history, including
findings calculated from it, to OpenAI.
**Include selected Google Calendar timing** separately enables Calendar timing.
Calendar descriptions and credentials are excluded. Notes require the separate
control described below. Provider retention may apply.

On the first Timeline opening each day, the horse presents the generated briefing.
Ignore it to keep tracking, or choose **Close** to dismiss it for this account,
day and installation. Tab to **Close** and press Enter or Space. A failed request
can show **Try again**; retries happen only when you choose that action.
Leaving Timeline while the brief loads does not lose it; it appears when you return.
If loading was interrupted, the bubble says so and offers **Try again**. When
Cadence gives a wait time, the button becomes available after it passes. Each
installation gets up to three retries per day.

When your Cadence server enables pattern tips, the brief occasionally includes a
**Pattern tip** drawn from your own history, such as
a weekday that tends to go unfinished. Cadence calculates the pattern and shows the
counts under the tip; a pattern is not proof of a cause. The same tip does not return
for about two weeks. When travel estimates are available, a **Travel** section lists
departures, the return and any Behavior that travel crowds. Cadence calculates these
lines from its travel estimates; the model does not write them.

In **Settings**, you can separately allow reminder delivery history and Notes on Not
Completed occurrences to inform tips, when your Cadence server uses them. Each option
describes exactly what is sent. Turning Daily Brief off turns both off.

Outlook Calendar, iCloud Calendar and Hevy each need their own choice before the
brief can use them. Connecting a source or showing it on Timeline never turns it on.
**Include selected Outlook Calendar timing** sends today's event times, availability
and your response for the selected calendars, without titles or details.
**Include selected iCloud Calendar timing** separately sends the same timing
projection for iCloud.
**Include today's recorded Hevy workout times** sends only the start and end of
workouts already recorded today. A recorded workout never completes a Behavior and
never shows when you are free. A source that is missing or partly read proves
nothing about your day. Each source needs its own connected account and separate permission.
If you reconnect a source or change its calendars, the brief stops using it and
Settings says so under that source. Choose **Allow Outlook Calendar again** or
**Allow iCloud Calendar again** or **Allow Hevy again** to let the brief use it, or turn it off. Until you choose, the
brief cannot start. If a source is disconnected or has no selected calendars,
Settings says which; reconnect it or choose calendars in Connectors, then turn it
on again. Changing any other Daily Brief choice turns off every source that is
waiting for your decision; it never allows one again for you. Turning Daily Brief
off turns all of these off, and an older Cadence app that saves Daily Brief settings
also turns them off.

The briefing can recommend changes but cannot apply them. Cadence stores no
briefing history. When its timing expires, the bubble offers **Get a fresh brief**.
After you mark an occurrence or other Timeline facts change, it offers **Refresh brief**.
Neither regenerates automatically. Disable Daily Brief in Settings to stop generation.

Linked, online desktop accounts use hosted information. Unsynchronized and
local-only records are absent; offline tracking still works without Daily Brief.

Daily Brief suggestions are read-only. Any displayed scheduling option is hypothetical.
A source link opens trusted catalog provenance. Editorial guidance is labeled separately
from research. A citation is not a guarantee that advice applies to you.

## Refresh Timeline

At the top of Timeline, pull downward on mobile and release after **Release to
refresh** appears. On desktop, scroll upward past the top with a trackpad or mouse
wheel. Start outside buttons, fields, and open dialogs.

Cadence reloads the Timeline and connected Calendar data. Successful reloads
show a brief confirmation. Failed or partial reloads show an error and preserve
existing data. Linked desktop accounts also synchronize through the existing
account connection. Local desktop tracking remains usable without a connection.

Normal scrolling, short or horizontal gestures, and repeated input during a
reload do not start another reload. This action never changes an Occurrence
status, Note, timer, or schedule. Browser keyboard reload remains available.

## Reveal more future days

**Prerequisites:** The generated future horizon contains days beyond the ones
currently shown.

1. Scroll below the visible Timeline days.
2. Choose **Show more days**.
3. Continue using **Show more days** until the control disappears or you have
   enough context.

**Result and persistence:** Cadence reloads Timeline with a larger, bounded
`days` value in the URL. This changes only the view; it does not resolve,
create, or reschedule an Occurrence.

**Recovery or undo:** Return to `/timeline` without the `days` query or use
browser Back to restore the prior visible range. Unsupported query values are
normalized to a supported range.

**Privacy and safety:** Future Occurrences are previews of the generated
schedule, not claims that the Behavior was completed or due now.

**Keyboard and mobile:** Focus **Show more days** and press Enter. The page
preserves useful scroll context. On mobile, allow the bottom fixed
**Needs decision** action enough space when reaching the link.

## Open or close Occurrence details

**Prerequisites:** At least one Occurrence row is visible on Timeline or in
**Needs decision**.

1. Activate the row summary outside **Completed** and **Not Completed**.
2. Read **Description**, **Category**, and **Schedule** in the expanded area.
3. Use the same summary again to collapse it.

**Result and persistence:** The native disclosure opens or closes in the
current page only. No record changes.

**Recovery or undo:** Activate the summary again. If navigation replaced the
page, reopen the row after returning.

**Privacy and safety:** Expanded details can expose private Description,
Category, schedule, status, and Note text to anyone viewing the screen.

**Keyboard and mobile:** Focus the row summary and press Enter or Space. The
summary has no separate chevron control. On mobile, the time, title, and status
actions share a compact row; the title may truncate visually, while its full
accessible text remains available.

## Record an Occurrence status

**Prerequisites:** The Occurrence is visible and you are signed in with a valid
session.

1. On an Unresolved row, choose **Completed** or **Not Completed**.
2. Wait for the saving state to finish before making another correction.
3. A resolved row shows its status as text. To change a resolved choice, open
   the row and use **Completed** or **Not Completed** under **Change status**.
4. To return a just-decided expanded Timeline Occurrence to Unresolved, use
   **Unmark**. For a later deliberate correction, use **Clear decision** from
   the Behavior's dated review. See
   [Review and correct one day](behaviors-and-review.md#review-and-correct-one-day).

**Result and persistence:** Cadence atomically updates the Occurrence snapshot,
appends a status-history event when the choice actually changes, cancels
eligible pending reminders, and refreshes the view. A new transition to
**Completed** plays at most one short completion sound when browser audio is
available. **Not Completed** does not play it. Repeating the already-current
resolved choice does not add duplicate history or replay the sound.

**Recovery or undo:** If saving fails, Cadence rolls back the optimistic row
state, shows an error, and keeps the last stored status. Change an incorrect
resolved choice from the expanded row during the immediate workflow, or use
the Behavior dated review later.

**Privacy and safety:** **Not Completed** is an explicit record, not an
automatic missed or failed state. A status change affects adherence and may
cancel a reminder that has not sent yet. It does not recall reminders already
sent.

**Keyboard and mobile:** **Completed** and **Not Completed** are real buttons
with text and icons; do not identify state by blue or red color alone. Tab to
the action and press Enter or Space. Each action keeps at least a 44-pixel
mobile target, even when adjacent text truncates. Saving status is announced to
assistive technology.

## Unmark a decision from the Timeline

**Prerequisites:** You just marked an expanded Timeline Occurrence
**Completed** or **Not Completed**, and the resolved row remains expanded.

1. Choose **Unmark** under **Change status**.
2. Wait for the saving state to finish.

**Result and persistence:** The Occurrence returns to **Unresolved**, Cadence
appends a correction event, and only reminders whose scheduled send time is
still in the future are restored.

**Recovery or undo:** If saving fails, Cadence shows a factual error and keeps
the resolved status. To clear the decision later, open the Behavior's dated
review and choose **Clear decision**.

**Keyboard and mobile:** **Unmark** is a real button with a text label and a
44-pixel minimum target. Tab to it and press Enter or Space.

## Save or edit an Occurrence Note

**Prerequisites:** Expand the Occurrence on Timeline, in **Needs decision**, or
in a Behavior dated review.

1. Enter or edit text in **Note**, whose placeholder is **Add a note** when
   empty.
2. Choose **Save note**.
3. Wait for **Saving...** to finish and confirm the success or error message.

**Result and persistence:** Only the Occurrence Note changes. Saving a Note
does not change status, status timestamps, or status-history events.

**Recovery or undo:** If saving fails, the stored Note remains unchanged. Edit
the field and submit again. To remove a Note, clear its text and choose
**Save note**.

**Privacy and safety:** Notes are free text and may be included in exports only
when **Include occurrence notes** is applied. Do not store sensitive details
you do not want hosted or exported. Imported note records do not necessarily
become this inline Note field.

**Keyboard and mobile:** Use Tab to enter **Note**, type normally, then Tab to
**Save note** and press Enter. The textarea can be resized where the browser
supports it. At high zoom it stacks above its action rather than requiring a
horizontal pointer gesture.

## Use a Note shortcut

Open **Settings** and enable **Note shortcuts**. Open an active Behavior's
**Details and Settings**, enable its Note shortcuts, then choose **Find repeated
Notes**. Cadence checks only that Behavior's repeated Notes when you request it.
Review a proposal before choosing **Accept**, or edit it first. You can later
edit or remove accepted shortcuts in the same Behavior settings.

Open an Occurrence Note form and choose an accepted shortcut. Cadence fills an
empty draft or appends the shortcut on a new line. Review the draft, then choose
**Save note**. Shortcut selection does not save the Note, change status, or send
a reminder. A shortcut added while a Note save is pending remains in the draft.

Turning off the global setting hides quick-fill buttons and proposals. It keeps
accepted shortcuts and saved Notes. Removing a shortcut keeps saved Notes and
suppresses that repeated pattern for 90 days.

## Track occurrence time

**Prerequisites:** Expand an active Behavior's current-day Occurrence or an
Occurrence visible in **Needs decision**.

1. Choose **Track Time**. Cadence saves the start before showing the counter.
2. Choose **Stop** when finished. The row shows the combined saved time.
3. Choose **Track Time** again for another interval when needed.
4. Choose **Reset tracked time** to remove every captured interval for that
   Occurrence, including a running interval.

**Result and persistence:** Refreshing restores a running counter from the
saved start instant. A final total sums stopped intervals only. Start does not
mark an Occurrence Completed or Not Completed and does not change reminders.
An idle or stopped timer shows one underlined **Track Time** action. While the
timer runs, **Track time** is a static label above the counter and actions.

**Recovery or undo:** Stop or Reset remains available after local midnight for
an earlier valid start. Reset is an immediate correction and cannot restore
deleted timing sessions.

**Keyboard and mobile:** Tab to each text action and press Enter or Space.
Start, Stop, Reset, and failures announce one result; the one-second counter
does not repeatedly announce itself.

## Review Needs decision

**Prerequisites:** At least one prior-day Unresolved Occurrence exists, or a
prior-day decision made today is retained for immediate review. Otherwise the
launcher is not rendered.

1. Choose the floating **Needs decision** action. If no Unresolved items remain
   but today's prior-day corrections are retained, its detail reads
   **Review decisions from today**.
2. Review the date groups. Each group states how many items remain to decide;
   a retained group with none left says **None left to decide**.
3. For an Unresolved row, choose **Completed** or **Not Completed**.
4. Expand a row to edit its Note or correct a resolved choice.
5. Close the dialog with **Close Needs decision** or Escape.

**Result and persistence:** Opening and closing the dialog changes no data,
locks or unlocks background scrolling, and restores focus to the launcher.
Status and Note actions persist exactly as described above. A prior-day row
resolved today remains in its original date group through the current local
day so an accidental choice can be reviewed; it leaves this dialog after the
next local midnight.

**Recovery or undo:** If the dialog is already closed, Escape has no effect.
If a status save fails, the last stored status is restored and the dialog stays
usable. For a later correction after the retained window, open the Behavior's
non-empty calendar day and use **Review**.

**Privacy and safety:** **Needs decision** does not write a separate status and
does not mean missed. Its count includes only prior-day Unresolved Occurrences,
not resolved rows retained for same-day correction.

**Keyboard and mobile:** Focus moves into the dialog when it opens and remains
inside until close. Tab and Shift+Tab cycle through the dialog; Escape closes
it and returns focus. On mobile, the launcher spans the lower safe-area width
and the dialog fills the viewport. Dates, counts, status words, and icons
communicate meaning without relying on color.

## Day progress and optional Calendar context

The forward Timeline places occurrences chronologically beside a continuous day
line. A blue dot shows the current position. Expanding Notes keeps the same time
mapping. Show more days extends the same line. Manual statuses and Needs decision
keep their existing meaning. No status changes automatically at midnight.

Deployment and installed-build acceptance require their own release evidence.
When the deployment is configured, connect Calendar separately in Settings with the same Google account used for Cadence. Ordinary Google sign-in
does not grant Calendar access. Cadence tracking remains available without
Calendar.

1. Open **Settings** and choose **Connect Google Calendar**.
2. Review Google's consent screen. Cadence requests read-only access to the
   Calendar list and events. Choose the same Google identity as the Cadence
   account.
3. Select the readable calendars Cadence may show. Set **Show Calendar context
   on Timeline**, **Show all-day events**, and each calendar's visibility.
4. Choose **Save Calendar settings**. Choose **Refresh Calendar** to request the
   displayed date range immediately.
5. On Timeline, preview an event by hovering, focusing, clicking, or tapping its
   marker. Choose **View details** for that event's centered modal. Close or Escape
   returns focus to the marker.
6. Choose a validated source link to open that event outside Cadence.
7. For an all-day item, choose **Dismiss** to hide it from this presentation.
   Choose **Restore** to show it again.

**Result and persistence:** Cadence reads only selected calendars for the
displayed inclusive local-date range. It never creates, edits, or deletes a
Google event. Calendar data never changes a Behavior schedule, Occurrence
status, Note, or reminder. All-day dismissal is local presentation state only.
The web keeps a memory-only snapshot. Desktop stores the last complete
matching snapshot in a separate local cache so it can show stale context while
offline. The cache is tied to the linked account and selected range. Cadence
refreshes on visible use and about every 15 minutes while visible. Desktop also
refreshes after a focused resume. Hidden or minimized desktop windows stop the
recurring refresh. A new complete request replaces details outside its selected
range and calendars.

**Recovery or undo:** A failed refresh keeps existing context when available
and labels it stale or unavailable. **Reconnect Google Calendar** starts fresh
consent when access expires or Google revokes it. **Disconnect Google Calendar**
deletes the live server credential and stops refresh. If Google cannot confirm
grant revocation, remove Cadence from Google Account permissions. Other devices
clear the connection when they next check it. Desktop account disconnect or
reconnect clears that Mac's Calendar cache while preserving Cadence history.

**Privacy and safety:** Cadence stores the Google refresh credential as encrypted
server-side ciphertext. The web and desktop apps do not receive that credential.
Desktop's event cache can contain event titles, descriptions, times, locations,
attendees, conference links, and attachment links that Google returned and the
selected permissions allowed. Cadence does not download attachments. Calendar
credentials and cached events stay outside Cadence exports, BehaviorLog bundles,
account synchronization, and user-created desktop backups. Supabase daily
backups may retain sealed credential ciphertext for the current seven-day window.
See [Privacy, account information, and deletion](privacy-and-account.md#google-calendar-data-and-disconnection).

## Connected sources: Outlook Calendar, iCloud Calendar, and Hevy

Settings lists every read-only source under **Connected sources**: Google
Calendar, Outlook Calendar, iCloud Calendar, and Hevy. Each source connects,
refreshes, fails, and disconnects on its own. Tracking never waits on a source.
On desktop, sources require a linked Cadence account. These instructions describe
locally verified source and synthetic flows. Live Microsoft, Apple and Hevy access,
installed desktop behavior and deployment remain unverified. iCloud custody
acceptance remains required before real credentials or release.

**Outlook Calendar** shows scheduled events like Google Calendar.

1. Choose **Connect Outlook Calendar** and sign in to a personal, work, or school
   Microsoft account. Your organization may need to approve Cadence first.
   On desktop, the browser returns to Cadence, which finishes only the connection
   it started.
2. Choose calendars and visibility, then **Save Outlook settings**.
3. Choose **Refresh Outlook Calendar** to read the displayed range now.
4. On Timeline, Outlook markers use a calendar icon and say "Outlook Calendar"
   in their label and details.

**Hevy** is recorded activity, not a calendar. It shows when each workout
started and how long it lasted. Provider responses can contain exercises, titles,
notes, sets and weights. Cadence discards those fields before creating its snapshot.

1. Hevy API access requires Hevy Pro. Create an API key in Hevy settings.
2. Enter the key once under **Hevy API key** and choose **Connect Hevy**. The
   field clears immediately. Cadence stores the key encrypted on its server and
   never on your device.
3. Choose **Refresh Hevy** to read today's workouts now.
4. On Timeline, today's workouts appear under **Recorded activity · Hevy** below
   the date, apart from Calendar markers.

**Result and persistence:** A workout never completes, changes, or matches a
Behavior or Occurrence, and Cadence never merges records by similar title or
time. Even today-only reads scan global history, bounded at 500 Hevy workouts;
a larger history reports incomplete without workout page reads. Count and page
checks mean no change was detected, not an atomic snapshot. Concurrent changes
can escape these checks. Desktop keeps one disposable cache per source and linked account,
outside the tracking database and user-created backups, and labels saved
context as possibly out of date while offline.

**Recovery or undo:** A failed or incomplete refresh keeps the last complete
read and labels it. **Disconnect Outlook Calendar** and **Disconnect Hevy**
delete Cadence's saved access and clear the local source cache. Other devices
clear it on their next connection check; offline data can remain stale. Cadence
does not revoke provider access: remove Cadence in Microsoft account privacy app permissions
(personal) or My Apps (work or school), and remove or regenerate the Hevy API
key in Hevy settings. Account switch and sign-out on desktop clear every source
cache.

**Keyboard and mobile:** Calendar markers have descriptive names and 44px
targets. Hover does not move focus. The preview does not trap focus. The details
drawer traps focus while open and returns it on close. Touch uses the same
preview and details actions.

Duration estimates use positive stopped-session totals from at least three Completed
occurrences in the previous 90 local days. Insufficient history shows unknown.
Running timers remain separate activity signals. Possible overlap is advisory;
unknown, incomplete, or stale Calendar data cannot establish availability. All-day
events do not create timed-overlap warnings.


### iCloud Calendar

The local implementation uses a hosted CalDAV connection on web and linked
desktop. It does not read calendars stored only on your Mac. Live Apple access,
installed desktop acceptance and release remain unverified.

1. Under **Connected sources**, read the custody disclosure. Apple does not limit
   an app-specific password to Calendar; it can also reach Mail, Contacts and
   other iCloud data. Cadence uses it only for Calendar reads.
2. Create an app-specific password at account.apple.com. Enter it with your Apple
   Account email and choose **Connect iCloud Calendar**. Never enter your primary
   Apple Account password. Both fields clear immediately. Cadence seals both
   values on its server; it does not save them on your device.
3. Select calendars and visibility, then choose **Save iCloud settings**.
   **Refresh iCloud Calendar** reads the displayed range. Markers and details
   name iCloud Calendar; duplicate events from other sources remain separate.
4. Allow selected iCloud timing in **Daily Brief** separately if desired.
   Reconnecting or changing selection requires **Allow iCloud Calendar again**.
5. **Disconnect iCloud Calendar** deletes Cadence's saved login and clears the
   local source cache. Other devices observe removal on their next connection check.
   Apple keeps the password active until you remove it at account.apple.com:
   **Sign-In and Security → App-Specific Passwords → Remove**, or **Revoke All**.
   Account deletion shows the same removal instruction.

Reads cover at most 32 calendars and 31 local dates. Unexpanded recurrence,
truncated data and malformed events make coverage incomplete. A failed refresh
can retain the last complete read with a stale label. Permission withdrawal
removes saved context from display. Desktop's disposable source cache preserves
calendar visibility and all-day choices for offline restart. It stays outside
tracking exports, synchronization and backups.

Owner acceptance of hosted app-specific-password custody is still required
before real credentials or user release. No live access is implied by these
local implementation instructions.

## Calendar for Daily Brief

Daily Brief uses a separate Calendar connection from the Timeline.
In Settings, open **Google Calendar for Daily Brief** and connect the Google account you use for Cadence.
Choose calendars and save. Then enable **Include calendars selected in Google Calendar for Daily Brief** under **Daily Brief**.
Connecting Calendar alone does not enable sharing with OpenAI.

If you previously included Timeline Calendar in Daily Brief, connect this separate grant and enable Calendar again after the update.
Disconnecting this connection stops Daily Brief Calendar reads across your devices. Your Timeline Calendar connection remains separate.
If this connection is not configured, you can still use Timeline Calendar and behavior-only Daily Brief when those features are available.
